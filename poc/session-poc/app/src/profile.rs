//! Tauri commands over the versioned profile store.
//!
//! The commands are thin: validation of the profile fields belongs to the agent, and
//! the store refuses only what would break its own invariants. Payloads cross the
//! boundary as JSON text, which the UI parses and validates.

use std::sync::Arc;

use serde::Serialize;
use session_poc_core::profile_store::{self, SearchSummary, Versioned};
use tauri::State;

use crate::AppState;

#[derive(Serialize)]
pub struct VersionView {
    pub version: i64,
    pub payload: String,
}

#[derive(Serialize)]
pub struct SearchView {
    pub id: String,
    pub name: String,
    pub status: String,
    pub version: i64,
    pub payload: String,
}

impl From<Versioned> for VersionView {
    fn from(value: Versioned) -> Self {
        VersionView { version: value.version, payload: value.payload }
    }
}

impl From<SearchSummary> for SearchView {
    fn from(value: SearchSummary) -> Self {
        SearchView {
            id: value.id,
            name: value.name,
            status: value.status,
            version: value.version,
            payload: value.payload,
        }
    }
}

#[tauri::command]
pub async fn onboarding_status(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    profile_store::onboarding_complete(&state.pool).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn onboarding_complete(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    profile_store::mark_onboarding_complete(&state.pool).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn identity_get(state: State<'_, Arc<AppState>>) -> Result<Option<VersionView>, String> {
    profile_store::current_identity(&state.pool)
        .await
        .map(|found| found.map(VersionView::from))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn identity_save(state: State<'_, Arc<AppState>>, payload: String) -> Result<i64, String> {
    profile_store::save_identity(&state.pool, &payload).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_list(state: State<'_, Arc<AppState>>) -> Result<Vec<SearchView>, String> {
    profile_store::list_searches(&state.pool)
        .await
        .map(|found| found.into_iter().map(SearchView::from).collect())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_create(
    state: State<'_, Arc<AppState>>,
    name: String,
    payload: String,
) -> Result<String, String> {
    profile_store::create_search(&state.pool, &name, &payload, None)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_save(
    state: State<'_, Arc<AppState>>,
    id: String,
    payload: String,
    apply_scope: String,
) -> Result<i64, String> {
    profile_store::save_search_version(&state.pool, &id, &payload, &apply_scope, None)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_duplicate(state: State<'_, Arc<AppState>>, id: String, name: String) -> Result<String, String> {
    profile_store::duplicate_search(&state.pool, &id, &name).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_set_status(state: State<'_, Arc<AppState>>, id: String, status: String) -> Result<(), String> {
    profile_store::set_search_status(&state.pool, &id, &status).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn search_history(state: State<'_, Arc<AppState>>, id: String) -> Result<Vec<VersionView>, String> {
    profile_store::search_history(&state.pool, &id)
        .await
        .map(|found| found.into_iter().map(VersionView::from).collect())
        .map_err(|error| error.to_string())
}

/// The latest payload of a search, only when that search is active. `None` means the search
/// is paused, deleted, or unknown, and it must not run.
pub async fn search_list_active(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    id: &str,
) -> Result<Option<String>, String> {
    let listed = profile_store::list_searches(pool).await.map_err(|error| error.to_string())?;
    Ok(listed
        .into_iter()
        .find(|search| search.id == id && search.status == "active")
        .map(|search| search.payload))
}
