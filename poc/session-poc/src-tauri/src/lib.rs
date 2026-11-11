//! Core of the Phase 0 desktop spike.
//!
//! This module is deliberately free of Tauri types so the same code can be
//! exercised headlessly by `session-poc-selftest`. The Tauri binary wires the
//! same functions into commands; the self-test proves the behaviour.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};

pub mod profile_store;
pub mod secrets;

/// SQLite pool with migrations applied. Creates the file if absent.
pub async fn open_database(path: &Path) -> Result<Pool<Sqlite>> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("creating database directory {}", parent.display()))?;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        // WAL keeps a reader (UI) from blocking the background writer.
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await
        .with_context(|| format!("opening sqlite database {}", path.display()))?;

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("running migrations")?;
    Ok(pool)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    Queued,
    Running,
    Done,
    Failed,
    Interrupted,
}

impl TaskState {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskState::Queued => "queued",
            TaskState::Running => "running",
            TaskState::Done => "done",
            TaskState::Failed => "failed",
            TaskState::Interrupted => "interrupted",
        }
    }

    pub fn parse(raw: &str) -> Result<Self> {
        Ok(match raw {
            "queued" => TaskState::Queued,
            "running" => TaskState::Running,
            "done" => TaskState::Done,
            "failed" => TaskState::Failed,
            "interrupted" => TaskState::Interrupted,
            other => anyhow::bail!("unknown task state {other}"),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: i64,
    pub kind: String,
    pub payload: String,
    pub state: TaskState,
    pub attempts: i64,
    pub result: Option<String>,
}

/// Insert a queued task and return its id.
pub async fn enqueue_task(pool: &Pool<Sqlite>, kind: &str, payload: &str) -> Result<i64> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO tasks (kind, payload, state) VALUES (?1, ?2, 'queued') RETURNING id",
    )
    .bind(kind)
    .bind(payload)
    .fetch_one(pool)
    .await
    .context("inserting task")?;

    record_event(pool, id, None, TaskState::Queued, Some("enqueued")).await?;
    Ok(id)
}

async fn record_event(
    pool: &Pool<Sqlite>,
    task_id: i64,
    from: Option<TaskState>,
    to: TaskState,
    note: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO task_events (task_id, from_state, to_state, note) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(task_id)
    .bind(from.map(TaskState::as_str))
    .bind(to.as_str())
    .bind(note)
    .execute(pool)
    .await
    .context("recording task event")?;
    Ok(())
}

/// Apply a state change and audit it, only while the row still holds the state
/// the caller observed.
///
/// The observed state is part of the `WHERE` clause, so the write is a
/// compare-and-swap: two callers that read the same row cannot both apply the
/// same transition. Returns whether it applied.
///
/// `counts_as_attempt` distinguishes a retryable execution from a terminal
/// outcome: finishing a task is the result of an attempt, not a new one.
async fn transition(
    pool: &Pool<Sqlite>,
    task: &Task,
    to: TaskState,
    result: Option<&str>,
    counts_as_attempt: bool,
) -> Result<bool> {
    let updated = sqlx::query(
        "UPDATE tasks SET state = ?1, result = COALESCE(?2, result), attempts = attempts + ?3, updated_at = datetime('now') WHERE id = ?4 AND state = ?5",
    )
    .bind(to.as_str())
    .bind(result)
    .bind(i64::from(counts_as_attempt))
    .bind(task.id)
    .bind(task.state.as_str())
    .execute(pool)
    .await
    .context("updating task state")?;
    if updated.rows_affected() == 0 {
        return Ok(false);
    }
    record_event(pool, task.id, Some(task.state), to, result).await?;
    Ok(true)
}

pub async fn get_task(pool: &Pool<Sqlite>, id: i64) -> Result<Task> {
    let row = sqlx::query_as::<_, (i64, String, String, String, i64, Option<String>)>(
        "SELECT id, kind, payload, state, attempts, result FROM tasks WHERE id = ?1",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .context("loading task")?;

    Ok(Task {
        id: row.0,
        kind: row.1,
        payload: row.2,
        state: TaskState::parse(&row.3)?,
        attempts: row.4,
        result: row.5,
    })
}

/// Mark every task left in `running` as `interrupted`.
///
/// A process that dies mid-task leaves a `running` row behind. Recovery is
/// explicit and audited rather than silent, so the UI can tell the user what
/// happened while the app was closed.
pub async fn recover_interrupted(pool: &Pool<Sqlite>) -> Result<Vec<i64>> {
    let ids = sqlx::query_scalar::<_, i64>("SELECT id FROM tasks WHERE state = 'running'")
        .fetch_all(pool)
        .await
        .context("finding interrupted tasks")?;

    for id in &ids {
        sqlx::query(
            "UPDATE tasks SET state = 'interrupted', updated_at = datetime('now') WHERE id = ?1",
        )
        .bind(id)
        .execute(pool)
        .await?;
        sqlx::query(
            "INSERT INTO task_events (task_id, from_state, to_state, note) VALUES (?1, 'running', 'interrupted', 'recovered after process restart')",
        )
        .bind(id)
        .execute(pool)
        .await?;
    }
    Ok(ids)
}

/// Mark a task done and record the audit event.
///
/// The desktop shell and any future scheduler share this path, so completing a
/// task from the UI leaves the same trace as completing it from the core. It does
/// not increment `attempts`: finishing is the outcome of an attempt, not a new one.
///
/// Completing twice is not an error: the second call writes nothing and keeps the
/// first result, so a double click or a retried command stays idempotent without
/// adding a second audit row.
pub async fn complete_task(pool: &Pool<Sqlite>, id: i64, result: &str) -> Result<()> {
    let task = get_task(pool, id).await?;
    if task.state == TaskState::Done {
        return Ok(());
    }
    if transition(pool, &task, TaskState::Done, Some(result), false).await? {
        return Ok(());
    }
    let current = get_task(pool, id).await?;
    if current.state == TaskState::Done {
        return Ok(());
    }
    anyhow::bail!(
        "task {id} moved to {} while it was being completed",
        current.state.as_str()
    )
}

/// Begin one execution of a task, counting a new attempt.
///
/// This is the only transition that counts an attempt: it opens the retryable
/// execution the queue exists for, while finishing or failing only closes the
/// attempt that was already counted.
///
/// A `queued` task starts its first attempt; an `interrupted` task — one a crash
/// left behind and `recover_interrupted` marked — starts the next one, which is
/// why `attempts` can reach 2. `failed` is terminal by choice: a failure is a
/// recorded outcome, not a resumable state, so it is refused instead of retried.
/// Anything else is refused with an error rather than silently ignored, so a
/// double click cannot invent an attempt that never ran.
pub async fn start_task(pool: &Pool<Sqlite>, id: i64) -> Result<()> {
    let task = get_task(pool, id).await?;
    match task.state {
        TaskState::Queued | TaskState::Interrupted => {}
        other => anyhow::bail!(
            "task {id} is {}, which cannot start an attempt",
            other.as_str()
        ),
    }
    if transition(pool, &task, TaskState::Running, None, true).await? {
        return Ok(());
    }
    anyhow::bail!("task {id} moved while it was being started")
}

/// Record a terminal failure for a running task, keeping the reason as its result.
///
/// Failing does not count a new attempt: it closes the one `start_task` opened.
/// Failing twice is not an error and keeps the first reason, so a double click or
/// a retried command stays idempotent without a second audit row — the same shape
/// as `complete_task`.
pub async fn fail_task(pool: &Pool<Sqlite>, id: i64, reason: &str) -> Result<()> {
    let task = get_task(pool, id).await?;
    if task.state == TaskState::Failed {
        return Ok(());
    }
    if task.state != TaskState::Running {
        anyhow::bail!("task {id} is {}, not running", task.state.as_str());
    }
    if transition(pool, &task, TaskState::Failed, Some(reason), false).await? {
        return Ok(());
    }
    let current = get_task(pool, id).await?;
    if current.state == TaskState::Failed {
        return Ok(());
    }
    anyhow::bail!(
        "task {id} moved to {} while it was being failed",
        current.state.as_str()
    )
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SidecarReport {    pub ok: bool,
    pub detail: String,
    pub elapsed_ms: u64,
}

/// Run the Node sidecar that drives the browser, and parse its JSON report.
///
/// The sidecar is a separate process on purpose: a browser driver cannot be
/// allowed to block or crash the Rust core, and a crashed driver must be
/// restartable without restarting the app.
pub async fn run_browser_sidecar(
    node_binary: &Path,
    script: &Path,
    profile_dir: &Path,
    url: &str,
    timeout: Duration,
) -> Result<SidecarReport> {
    tokio::fs::create_dir_all(profile_dir).await.ok();

    let mut command = tokio::process::Command::new(node_binary);
    command
        .arg(script)
        .arg("--profile")
        .arg(profile_dir)
        .arg("--url")
        .arg(url)
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("HOME", std::env::var("HOME").unwrap_or_default())
        .env(
            "PLAYWRIGHT_BROWSERS_PATH",
            std::env::var("PLAYWRIGHT_BROWSERS_PATH").unwrap_or_default(),
        )
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let output = tokio::time::timeout(timeout, command.output())
        .await
        .context("sidecar timed out")?
        .context("spawning sidecar")?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        anyhow::bail!("sidecar exited with {:?}: {}", output.status.code(), stderr.trim());
    }
    let report: SidecarReport = serde_json::from_str(stdout.trim())
        .with_context(|| format!("parsing sidecar output: {stdout}"))?;
    Ok(report)
}

/// Default data directory for the spike, under the OS application-support path.
pub fn default_data_dir(app_name: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home)
            .join("Library/Application Support")
            .join(app_name)
    }
    #[cfg(target_os = "windows")]
    {
        let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
        PathBuf::from(base).join(app_name)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var("XDG_DATA_HOME")
            .unwrap_or_else(|_| format!("{}/.local/share", std::env::var("HOME").unwrap_or_default()));
        PathBuf::from(base).join(app_name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool() -> Pool<Sqlite> {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("test.sqlite");
        // Leak the directory so the file outlives this helper in the test body.
        std::mem::forget(dir);
        open_database(&path).await.expect("open database")
    }

    #[tokio::test]
    async fn migrations_create_the_task_queue() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        let task = get_task(&pool, id).await.expect("get task");
        assert_eq!(task.state, TaskState::Queued);
        assert_eq!(task.kind, "browser_probe");
        assert_eq!(task.attempts, 0);
    }

    #[tokio::test]
    async fn recovery_marks_running_tasks_as_interrupted_and_records_an_event() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        sqlx::query("UPDATE tasks SET state = 'running' WHERE id = ?1")
            .bind(id)
            .execute(&pool)
            .await
            .expect("force running");

        let recovered = recover_interrupted(&pool).await.expect("recover");
        assert_eq!(recovered, vec![id]);

        let task = get_task(&pool, id).await.expect("get task");
        assert_eq!(task.state, TaskState::Interrupted);

        let events: Vec<String> = sqlx::query_scalar("SELECT to_state FROM task_events WHERE task_id = ?1 ORDER BY id")
            .bind(id)
            .fetch_all(&pool)
            .await
            .expect("events");
        assert_eq!(events, vec!["queued".to_string(), "interrupted".to_string()]);
    }

    #[tokio::test]
    async fn recovery_is_idempotent() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        sqlx::query("UPDATE tasks SET state = 'running' WHERE id = ?1")
            .bind(id)
            .execute(&pool)
            .await
            .expect("force running");
        assert_eq!(recover_interrupted(&pool).await.expect("first").len(), 1);
        assert!(recover_interrupted(&pool).await.expect("second").is_empty());
    }

    #[tokio::test]
    async fn a_done_task_is_never_touched_by_recovery() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        sqlx::query("UPDATE tasks SET state = 'done' WHERE id = ?1")
            .bind(id)
            .execute(&pool)
            .await
            .expect("force done");
        assert!(recover_interrupted(&pool).await.expect("recover").is_empty());
        assert_eq!(get_task(&pool, id).await.expect("get").state, TaskState::Done);
    }

    #[tokio::test]
    async fn completing_a_task_records_the_event_without_incrementing_attempts() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        complete_task(&pool, id, "finished in the shell").await.expect("complete");

        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Done);
        assert_eq!(task.result.as_deref(), Some("finished in the shell"));
        assert_eq!(task.attempts, 0);

        let events: Vec<String> = sqlx::query_scalar("SELECT to_state FROM task_events WHERE task_id = ?1 ORDER BY id")
            .bind(id)
            .fetch_all(&pool)
            .await
            .expect("events");
        assert_eq!(events, vec!["queued".to_string(), "done".to_string()]);
    }

    #[tokio::test]
    async fn completing_a_done_task_again_is_idempotent_and_never_rewrites_it() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        complete_task(&pool, id, "first").await.expect("complete");
        complete_task(&pool, id, "second").await.expect("a repeat is not an error");

        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Done);
        assert_eq!(task.result.as_deref(), Some("first"));
        let done_events: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM task_events WHERE task_id = ?1 AND to_state = 'done'")
                .bind(id)
                .fetch_one(&pool)
                .await
                .expect("events");
        assert_eq!(done_events, 1);
    }

    #[tokio::test]
    async fn a_transition_whose_observed_state_moved_is_not_applied() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        let observed = get_task(&pool, id).await.expect("get");
        sqlx::query("UPDATE tasks SET state = 'running' WHERE id = ?1")
            .bind(id)
            .execute(&pool)
            .await
            .expect("move the row behind the caller");

        let applied = transition(&pool, &observed, TaskState::Failed, Some("stale"), true)
            .await
            .expect("transition");
        assert!(!applied);
        assert_eq!(get_task(&pool, id).await.expect("get").result, None);
        assert_eq!(get_task(&pool, id).await.expect("get").state, TaskState::Running);
    }

    #[tokio::test]
    async fn a_transition_keeps_the_result_and_increments_attempts() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        let mut task = get_task(&pool, id).await.expect("get");
        task.state = TaskState::Queued;
        transition(&pool, &task, TaskState::Failed, Some("network down"), true)
            .await
            .expect("transition");
        let after = get_task(&pool, id).await.expect("get");
        assert_eq!(after.state, TaskState::Failed);
        assert_eq!(after.result.as_deref(), Some("network down"));
        assert_eq!(after.attempts, 1);
    }

    async fn event_count(pool: &Pool<Sqlite>, task_id: i64, to_state: &str) -> i64 {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM task_events WHERE task_id = ?1 AND to_state = ?2",
        )
        .bind(task_id)
        .bind(to_state)
        .fetch_one(pool)
        .await
        .expect("counting events")
    }

    #[tokio::test]
    async fn starting_a_queued_task_moves_it_to_running_and_counts_one_attempt() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");

        start_task(&pool, id).await.expect("start");

        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Running);
        assert_eq!(task.attempts, 1);
        assert_eq!(task.result, None);
        assert_eq!(event_count(&pool, id, "running").await, 1);
    }

    #[tokio::test]
    async fn starting_a_task_that_is_already_running_is_refused_and_writes_nothing() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        start_task(&pool, id).await.expect("start");

        let refused = start_task(&pool, id).await;

        assert!(refused.is_err(), "a running task must not start a second attempt");
        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Running);
        assert_eq!(task.attempts, 1);
        assert_eq!(event_count(&pool, id, "running").await, 1);
    }

    #[tokio::test]
    async fn retrying_an_interrupted_task_counts_a_second_attempt() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        start_task(&pool, id).await.expect("start");
        let recovered = recover_interrupted(&pool).await.expect("recover");
        assert_eq!(recovered, vec![id]);

        start_task(&pool, id).await.expect("retry after a crash");

        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Running);
        assert_eq!(task.attempts, 2);
        assert_eq!(event_count(&pool, id, "running").await, 2);
        assert_eq!(event_count(&pool, id, "interrupted").await, 1);
    }

    #[tokio::test]
    async fn a_failed_task_cannot_be_restarted() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        start_task(&pool, id).await.expect("start");
        fail_task(&pool, id, "sidecar exited with 1").await.expect("fail");

        let refused = start_task(&pool, id).await;

        assert!(refused.is_err(), "failed is terminal, so no retry is offered");
        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Failed);
        assert_eq!(task.attempts, 1);
        assert_eq!(task.result.as_deref(), Some("sidecar exited with 1"));
        assert_eq!(event_count(&pool, id, "running").await, 1);
    }

    #[tokio::test]
    async fn failing_a_running_task_keeps_the_single_attempt_and_records_the_reason() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        start_task(&pool, id).await.expect("start");

        fail_task(&pool, id, "sidecar exited with 1").await.expect("fail");

        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Failed);
        assert_eq!(task.attempts, 1, "failing is the outcome of an attempt, not a new one");
        assert_eq!(task.result.as_deref(), Some("sidecar exited with 1"));
        assert_eq!(event_count(&pool, id, "failed").await, 1);
    }

    #[tokio::test]
    async fn failing_a_failed_task_again_is_idempotent_and_keeps_the_first_reason() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        start_task(&pool, id).await.expect("start");
        fail_task(&pool, id, "first reason").await.expect("fail");

        fail_task(&pool, id, "second reason").await.expect("a repeat is not an error");

        let task = get_task(&pool, id).await.expect("get");
        assert_eq!(task.state, TaskState::Failed);
        assert_eq!(task.result.as_deref(), Some("first reason"));
        assert_eq!(event_count(&pool, id, "failed").await, 1);
    }
}
