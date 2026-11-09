//! Tauri 2 desktop shell for the Phase 0 spike.
//!
//! The shell is intentionally thin: every piece of behaviour lives in
//! `session_poc_core`, which the headless self-test exercises in separate
//! processes. What this binary proves is that the desktop stack builds, launches
//! and exposes those capabilities over Tauri commands.

mod agent;
mod ziprecruiter;

use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use serde::Serialize;
use session_poc_core::{complete_task, default_data_dir, enqueue_task, get_task, open_database, recover_interrupted, secrets};
use sqlx::{Pool, Sqlite};
use tauri::State;

struct AppState {
    pool: Pool<Sqlite>,
}

/// The two processes the window owns while the user browses the sources that need a login.
#[derive(Default)]
struct Sources {
    bridge: Option<Child>,
    browser: Option<Child>,
}

fn stop_sources(sources: &Mutex<Sources>) {
    if let Ok(mut held) = sources.lock() {
        if let Some(mut bridge) = held.bridge.take() {
            let _ = bridge.kill();
        }
        if let Some(mut browser) = held.browser.take() {
            let _ = browser.kill();
        }
    }
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
    // Always through the core, so a completion from the UI leaves the same audit
    // row as one from the scheduler.
    complete_task(&state.pool, id, &result)
        .await
        .map_err(|error| error.to_string())?;
    Ok("done".to_string())
}

/// Begin one execution of a task, counting an attempt.
///
/// Accepts a `queued` task (first attempt) and an `interrupted` one (the next
/// attempt after a crash), so this is the command that makes `attempts` and the
/// `running` state reachable from the UI at all.
#[tauri::command]
async fn start_task(state: State<'_, Arc<AppState>>, id: i64) -> Result<String, String> {
    session_poc_core::start_task(&state.pool, id)
        .await
        .map_err(|error| error.to_string())?;
    Ok("running".to_string())
}

/// Record a terminal failure for a running task, with the reason as its result.
#[tauri::command]
async fn fail_task(
    state: State<'_, Arc<AppState>>,
    id: i64,
    reason: String,
) -> Result<String, String> {
    session_poc_core::fail_task(&state.pool, id, &reason)
        .await
        .map_err(|error| error.to_string())?;
    Ok("failed".to_string())
}

/// The accounts the settings view can hold a key for.
const KEY_ACCOUNTS: [&str; 3] = ["typesafe", "anthropic", "qwen"];

/// Store an API key in the OS keyring.
///
/// The desktop app writes it natively, through the `keyring` crate, so the secret never
/// touches a file and never appears in a process argument list — the two things `AGENTS.md`
/// forbids. The agent reads it back through the same keychain.
#[tauri::command]
fn agent_save_key(account: String, value: String) -> Result<(), String> {
    if !KEY_ACCOUNTS.contains(&account.as_str()) {
        return Err(format!("unknown key account: {account}"));
    }
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("the key is empty".to_string());
    }
    secrets::store_secret(&account, trimmed).map_err(|error| error.to_string())
}

/// Run the agent from the window. `dry_run` fetches and filters without buying a judgment.
#[tauri::command]
async fn agent_run(dry_run: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || agent::run_once(dry_run))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// Connect ZipRecruiter: open the consent page, wait for the loopback redirect, exchange
/// the code and keep the token in the keyring.
///
/// `client_id` is the URL the maintainer publishes the metadata document at; ZipRecruiter
/// fetches it to identify this client, which is why the app needs no registered secret.
#[tauri::command]
async fn ziprecruiter_connect(client_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let pair = ziprecruiter::pkce().map_err(|error| error.to_string())?;
        let state = uuid_like();
        let url = ziprecruiter::authorize_url(&client_id, &state, &pair.challenge);

        std::process::Command::new("open")
            .arg(&url)
            .status()
            .map_err(|error| format!("non riesco ad aprire il browser: {error}"))?;

        let code = ziprecruiter::wait_for_callback(&state, std::time::Duration::from_secs(180))
            .map_err(|error| error.to_string())?;
        let token = ziprecruiter::exchange_code(&client_id, &code, &pair.verifier)
            .map_err(|error| error.to_string())?;

        // The keyring, not a file: this is the same rule the API keys follow.
        secrets::store_secret("ziprecruiter", &token.access_token)
            .map_err(|error| format!("token non salvato nel portachiavi: {error}"))?;

        Ok(match token.expires_in {
            Some(seconds) => format!("ZipRecruiter collegato; il token scade in {seconds} secondi"),
            None => "ZipRecruiter collegato".to_string(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Fetch postings through ZipRecruiter's MCP server and leave them where the agent reads
/// them, so one judging path and one evidence format stay in place.
#[tauri::command]
async fn ziprecruiter_fetch(query: String, location: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let token = secrets::read_secret("ziprecruiter")
            .map_err(|error| error.to_string())?
            .ok_or("ZipRecruiter non è collegato: usa il pulsante Collega nelle impostazioni")?;

        // Every MCP session starts with initialize; the server answers with its capabilities.
        ziprecruiter::call_mcp(&token, &ziprecruiter::initialize_request(1))
            .map_err(|error| error.to_string())?;

        let answer = ziprecruiter::call_mcp(
            &token,
            &ziprecruiter::search_request(2, &query, location.as_deref()),
        )
        .map_err(|error| error.to_string())?;

        let postings = ziprecruiter::postings_from_response(&answer).map_err(|error| error.to_string())?;
        ziprecruiter::write_postings(&postings).map_err(|error| error.to_string())?;

        Ok(format!(
            "{} annunci ZipRecruiter salvati: il prossimo giro li giudica",
            postings.len()
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// A random-enough state value for one authorization attempt.
fn uuid_like() -> String {
    let mut bytes = [0u8; 16];
    if let Ok(mut file) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = file.read_exact(&mut bytes);
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Start the bridge if needed and open the dedicated browser with the extension loaded,
/// so the user never manages a profile, an extension or a token.
#[tauri::command]
async fn agent_open_sources(sources: State<'_, Arc<Mutex<Sources>>>) -> Result<String, String> {
    let held = Arc::clone(&sources);
    tauri::async_runtime::spawn_blocking(move || {
        let bridge_started = agent::start_bridge().map_err(|error| error.to_string())?;
        let browser = agent::open_browser().map_err(|error| error.to_string())?;
        let mut guard = held.lock().map_err(|error| error.to_string())?;
        if let Some(child) = bridge_started {
            guard.bridge = Some(child);
        }
        guard.browser = Some(browser);
        Ok::<String, String>(format!(
            "bridge on 127.0.0.1:8787 · browser profile {}",
            agent::browser_profile_dir().display()
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Close what the window started.
#[tauri::command]
fn agent_stop_sources(sources: State<'_, Arc<Mutex<Sources>>>) -> Result<(), String> {
    stop_sources(&sources);
    Ok(())
}

/// Which accounts have a key, without returning any of them.
#[tauri::command]
fn agent_key_status() -> Result<std::collections::BTreeMap<String, bool>, String> {
    let mut status = std::collections::BTreeMap::new();
    for account in KEY_ACCOUNTS {
        let present = secrets::read_secret(account).map_err(|error| error.to_string())?.is_some();
        status.insert(account.to_string(), present);
    }
    Ok(status)
}

/// The last job-agent run, projected for the results view. `None` means the agent has
/// never run in this profile: the window says so instead of showing an empty table.
#[tauri::command]
async fn agent_last_run() -> Result<Option<agent::AgentRunView>, String> {
    let dir = agent::evidence_dir();
    tauri::async_runtime::spawn_blocking(move || agent::read_latest(&dir))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
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
    let sources: Arc<Mutex<Sources>> = Arc::new(Mutex::new(Sources::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(state)
        .manage(Arc::clone(&sources))
        .invoke_handler(tauri::generate_handler![
            enqueue_probe,
            list_tasks,
            recover_tasks,
            finish_task,
            start_task,
            fail_task,
            keyring_probe,
            task_detail,
            agent_last_run,
            agent_save_key,
            agent_key_status,
            agent_run,
            agent_open_sources,
            agent_stop_sources,
            ziprecruiter_connect,
            ziprecruiter_fetch
        ])
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application")
        .run(move |_handle, event| {
            // A bridge or browser left running after the window closes is a process the
            // user did not ask for and cannot see.
            if let tauri::RunEvent::Exit = event {
                stop_sources(&sources);
            }
        });
}
