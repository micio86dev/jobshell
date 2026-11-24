//! Tauri commands over the lead store.
//!
//! The commands are thin: the rules (what a lead is, what feedback is allowed, what counts as
//! evidence) live in `session_poc_core::lead_store`. Nothing here sends anything to a company.

use std::sync::Arc;

use serde_json::Value;
use session_poc_core::lead_store::{self, LeadSummary};
use tauri::State;

use crate::AppState;

/// The leads of one view: `inbox`, `later`, `contacted`, `dismissed`, `rejected` or `all`.
#[tauri::command]
pub async fn lead_list(state: State<'_, Arc<AppState>>, view: String) -> Result<Vec<LeadSummary>, String> {
    lead_store::list_leads(&state.pool, &view).await.map_err(|error| error.to_string())
}

/// One lead with its score lines, signals, facts, contacts, drafts and decisions.
#[tauri::command]
pub async fn lead_detail(state: State<'_, Arc<AppState>>, id: i64) -> Result<Option<Value>, String> {
    lead_store::lead_detail(&state.pool, id).await.map_err(|error| error.to_string())
}

/// Record a decision on a lead. It is appended to the log, so it can be undone with `new`.
#[tauri::command]
pub async fn lead_event(
    state: State<'_, Arc<AppState>>,
    id: i64,
    event: String,
    note: Option<String>,
) -> Result<(), String> {
    lead_store::record_event(&state.pool, id, &event, note.as_deref()).await.map_err(|error| error.to_string())
}

/// Forget a company: delete it and everything held about it.
#[tauri::command]
pub async fn lead_forget(state: State<'_, Arc<AppState>>, key: String) -> Result<u64, String> {
    lead_store::delete_company(&state.pool, &key).await.map_err(|error| error.to_string())
}

/// Delete the leads untouched for `days` days, except the ones the user contacted or converted.
#[tauri::command]
pub async fn lead_purge(state: State<'_, Arc<AppState>>, days: u32) -> Result<u64, String> {
    lead_store::purge_older_than(&state.pool, days).await.map_err(|error| error.to_string())
}

/// The latest runs with their funnel and cost.
#[tauri::command]
pub async fn lead_runs(state: State<'_, Arc<AppState>>, limit: i64) -> Result<Vec<Value>, String> {
    lead_store::recent_runs(&state.pool, limit).await.map_err(|error| error.to_string())
}
