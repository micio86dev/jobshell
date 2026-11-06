//! Tauri 2 desktop shell for the Phase 0 spike.
//!
//! The shell is intentionally thin: every piece of behaviour lives in
//! `session_poc_core`, which the headless self-test exercises in separate
//! processes. What this binary proves is that the desktop stack builds, launches
//! and exposes those capabilities over Tauri commands.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use serde::Serialize;
use session_poc_core::{default_data_dir, enqueue_task, get_task, open_database, recover_interrupted, secrets};
use sqlx::{Pool, Sqlite};
use tauri::State;

struct AppState {
    pool: Pool<Sqlite>,
}

#[derive(Serialize)]
struct TaskView {
    id: i64,
    kind: String,
    state: String,
    attempts: i64,
    result: Option<String>,
}

#[tauri::command]
async fn enqueue_probe(state: State<'_, Arc<AppState>>, kind: String) -> Result<i64, String> {
    enqueue_task(&state.pool, &kind, "{}").await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_tasks(state: State<'_, Arc<AppState>>) -> Result<Vec<TaskView>, String> {
    let rows = sqlx::query_as::<_, (i64, String, String, i64, Option<String>)>(
        "SELECT id, kind, state, attempts, result FROM tasks ORDER BY id DESC LIMIT 50",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, kind, state, attempts, result)| TaskView { id, kind, state, attempts, result })
        .collect())
}

#[tauri::command]
async fn recover_tasks(state: State<'_, Arc<AppState>>) -> Result<Vec<i64>, String> {
    recover_interrupted(&state.pool).await.map_err(|error| error.to_string())
}

#[tauri::command]
async fn finish_task(state: State<'_, Arc<AppState>>, id: i64, result: String) -> Result<String, String> {
    sqlx::query("UPDATE tasks SET state = 'done', result = ?1, updated_at = datetime('now') WHERE id = ?2")
        .bind(result)
        .bind(id)
        .execute(&state.pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok("done".to_string())
}

#[tauri::command]
fn keyring_probe(account: String) -> Result<bool, String> {
    secrets::store_secret(&account, "probe-value").map_err(|error| error.to_string())?;
    let value = secrets::read_secret(&account).map_err(|error| error.to_string())?;
    secrets::delete_secret(&account).map_err(|error| error.to_string())?;
    Ok(value.as_deref() == Some("probe-value"))
}

#[tauri::command]
async fn task_detail(state: State<'_, Arc<AppState>>, id: i64) -> Result<TaskView, String> {
    let task = get_task(&state.pool, id).await.map_err(|error| error.to_string())?;
    Ok(TaskView {
        id: task.id,
        kind: task.kind,
        state: task.state.as_str().to_string(),
        attempts: task.attempts,
        result: task.result,
    })
}

/// The data directory is created by `open_database`; logging it makes the spike
/// honest about where a candidate's local state lives.
fn tracing_hint(data_dir: &PathBuf) {
    eprintln!("phase0 spike data directory: {}", data_dir.display());
}

fn main() {
    let data_dir = default_data_dir("openjob-phase0");
    let pool = tauri::async_runtime::block_on(async { open_database(&data_dir.join("spike.sqlite")).await })
        .expect("open sqlite database");

    tracing_hint(&data_dir);
    let state = Arc::new(AppState { pool });

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            enqueue_probe,
            list_tasks,
            recover_tasks,
            finish_task,
            keyring_probe,
            task_detail
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Tauri application");
}
