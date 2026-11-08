//! Headless self-test for the Phase 0 spike.
//!
//! Two phases run in two separate OS processes, which is the only honest way to
//! prove crash recovery: the first phase leaves a task in `running` and exits
//! without cleaning up, exactly like a crash; the second phase starts a new
//! process and must find and recover that task.

use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::json;
use session_poc_core::{
    default_data_dir, enqueue_task, get_task, open_database, recover_interrupted,
    run_browser_sidecar, secrets, start_task,
};

fn arg(name: &str) -> Option<String> {
    let flag = format!("--{name}");
    let mut args = std::env::args().skip(1);
    while let Some(current) = args.next() {
        if current == flag {
            return args.next();
        }
        if let Some(value) = current.strip_prefix(&format!("{flag}=")) {
            return Some(value.to_string());
        }
    }
    None
}

fn data_dir() -> PathBuf {
    arg("data-dir")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_data_dir("openjob-phase0"))
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let phase = arg("phase").unwrap_or_else(|| "all".to_string());
    let dir = data_dir();
    let db_path = dir.join("spike.sqlite");
    let pool = open_database(&db_path).await?;

    let mut results = serde_json::Map::new();

    if phase == "crash" {
        // Phase 1: enqueue a task, start a real attempt, then die without cleanup.
        //
        // The attempt goes through `start_task` rather than a direct UPDATE so the
        // evidence shows a state the shipped code can actually produce: `attempts`
        // is 1 and the `queued -> running` transition is audited.
        let id = enqueue_task(&pool, "browser_probe", r#"{"url":"fixture"}"#).await?;
        start_task(&pool, id).await.context("starting the task before the crash")?;
        let started = get_task(&pool, id).await?;
        println!(
            "{}",
            json!({
                "phase": "crash",
                "task_id": id,
                "state": started.state.as_str(),
                "attempts": started.attempts,
            })
        );
        return Ok(());
    }

    // Phase 2 (or a single-process run): recovery of whatever the last process left.
    let recovered = recover_interrupted(&pool).await?;
    results.insert("recovered_task_ids".into(), json!(recovered));
    if let Some(first) = recovered.first() {
        let task = get_task(&pool, *first).await?;
        results.insert(
            "recovered_task_state".into(),
            json!(task.state.as_str()),
        );
        results.insert("recovered_task_attempts".into(), json!(task.attempts));
        // Resume the recovered work as a second attempt. `start_task` accepts an
        // `interrupted` task for exactly this reason, so the restart is audited and
        // `attempts` keeps counting instead of the row being rewritten behind the log.
        start_task(&pool, *first).await.context("resuming the recovered task")?;
        let resumed = get_task(&pool, *first).await?;
        results.insert("resumed_task_id".into(), json!(first));
        results.insert("resumed_task_state".into(), json!(resumed.state.as_str()));
        results.insert("resumed_task_attempts".into(), json!(resumed.attempts));
    }

    // Keyring round trip (explicitly requested: a CI runner has no unlocked keychain).
    if arg("skip-keyring").is_none() {
        match secrets::store_secret("selftest-account", "probe-value")
            .and_then(|()| secrets::read_secret("selftest-account"))
            .and_then(|value| {
                secrets::delete_secret("selftest-account")?;
                Ok(value)
            }) {
            Ok(value) => {
                results.insert("keyring".into(), json!({ "ok": value.as_deref() == Some("probe-value") }));
            }
            Err(error) => {
                results.insert("keyring".into(), json!({ "ok": false, "error": error.to_string() }));
            }
        }
    }

    // Sidecar: a Node process drives the browser and reports JSON back.
    if let (Some(node), Some(script)) = (arg("node"), arg("sidecar")) {
        let profile = dir.join("browser-profile");
        let url = arg("url").unwrap_or_else(|| "http://127.0.0.1:1/login".to_string());
        let started = std::time::Instant::now();
        match run_browser_sidecar(&PathBuf::from(node), &PathBuf::from(script), &profile, &url, Duration::from_secs(120)).await {
            Ok(report) => {
                results.insert(
                    "sidecar".into(),
                    json!({ "ok": report.ok, "detail": report.detail, "reported_ms": report.elapsed_ms, "wall_ms": started.elapsed().as_millis() }),
                );
            }
            Err(error) => {
                results.insert("sidecar".into(), json!({ "ok": false, "error": error.to_string() }));
            }
        }
    }

    results.insert("database".into(), json!(db_path.display().to_string()));
    results.insert(
        "task_count".into(),
        json!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks").fetch_one(&pool).await?),
    );
    results.insert(
        "interrupted_remaining".into(),
        json!(sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks WHERE state = 'interrupted'").fetch_one(&pool).await?),
    );

    println!("{}", serde_json::Value::Object(results));
    Ok(())
}
