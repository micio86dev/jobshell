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

/// Apply a state change and audit it. Used by the tests today and by the
/// Phase 1 scheduler tomorrow; kept in the core so both share one code path.
#[cfg_attr(not(test), allow(dead_code))]
async fn transition(
    pool: &Pool<Sqlite>,
    task: &Task,
    to: TaskState,
    result: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "UPDATE tasks SET state = ?1, result = COALESCE(?2, result), attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?3",
    )
    .bind(to.as_str())
    .bind(result)
    .bind(task.id)
    .execute(pool)
    .await
    .context("updating task state")?;
    record_event(pool, task.id, Some(task.state), to, result).await
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

#[derive(Debug, Serialize, Deserialize)]
pub struct SidecarReport {
    pub ok: bool,
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
    async fn a_transition_keeps_the_result_and_increments_attempts() {
        let pool = pool().await;
        let id = enqueue_task(&pool, "browser_probe", "{}").await.expect("enqueue");
        let mut task = get_task(&pool, id).await.expect("get");
        task.state = TaskState::Queued;
        transition(&pool, &task, TaskState::Failed, Some("network down")).await.expect("transition");
        let after = get_task(&pool, id).await.expect("get");
        assert_eq!(after.state, TaskState::Failed);
        assert_eq!(after.result.as_deref(), Some("network down"));
        assert_eq!(after.attempts, 1);
    }
}
