//! Versioned storage for the candidate identity and the searches built on it.
//!
//! Nothing here is updated in place: every change appends a version. A search keeps
//! every version it has had, so a historical run can always be explained. Payloads are
//! stored as opaque JSON objects; their schema is validated by the agent, which is the
//! single validator for the profile.

use anyhow::{bail, Context, Result};
use sqlx::{Pool, Row, Sqlite};

/// How far an identity change reaches. The UI offers exactly these three choices.
pub const APPLY_SCOPES: [&str; 3] = ["new_only", "active_searches", "all_future"];

/// Search lifecycle. `deleted` is a soft delete: the history stays readable.
const SEARCH_STATUSES: [&str; 3] = ["active", "paused", "deleted"];

/// One stored version: its number and its JSON payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Versioned {
    pub version: i64,
    pub payload: String,
}

/// A search with the status and payload of its latest version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub version: i64,
    pub payload: String,
}

/// A payload is stored only if it is a JSON object. Its fields are validated by the agent.
fn require_object(payload: &str) -> Result<()> {
    match serde_json::from_str::<serde_json::Value>(payload) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        Ok(_) => bail!("a profile payload must be a JSON object"),
        Err(error) => bail!("a profile payload must be valid JSON: {error}"),
    }
}

/// Append a new identity version and return its number.
pub async fn save_identity(pool: &Pool<Sqlite>, payload: &str) -> Result<i64> {
    require_object(payload)?;
    let result = sqlx::query("INSERT INTO identity_versions (payload) VALUES (?)")
        .bind(payload)
        .execute(pool)
        .await
        .context("appending an identity version")?;
    Ok(result.last_insert_rowid())
}

/// The newest identity version, if the user has saved one.
pub async fn current_identity(pool: &Pool<Sqlite>) -> Result<Option<Versioned>> {
    let row = sqlx::query("SELECT version, payload FROM identity_versions ORDER BY version DESC LIMIT 1")
        .fetch_optional(pool)
        .await
        .context("reading the identity")?;
    Ok(row.map(|row| Versioned { version: row.get("version"), payload: row.get("payload") }))
}

/// Create a search with its first version and return its id.
pub async fn create_search(
    pool: &Pool<Sqlite>,
    name: &str,
    payload: &str,
    identity_version: Option<i64>,
) -> Result<String> {
    require_object(payload)?;
    let name = name.trim();
    if name.is_empty() {
        bail!("a search needs a name");
    }
    let mut tx = pool.begin().await.context("starting a search")?;
    let id: String = sqlx::query_scalar(
        "INSERT INTO searches (id, name, status) VALUES (lower(hex(randomblob(8))), ?, 'active') RETURNING id",
    )
    .bind(name)
    .fetch_one(&mut *tx)
    .await
    .context("creating the search")?;
    sqlx::query(
        "INSERT INTO search_versions (search_id, version, payload, apply_scope, identity_version) \
         VALUES (?, 1, ?, 'new_only', ?)",
    )
    .bind(&id)
    .bind(payload)
    .bind(identity_version)
    .execute(&mut *tx)
    .await
    .context("writing the first search version")?;
    tx.commit().await.context("committing the search")?;
    Ok(id)
}

/// Append a new version to a search. Refused for a deleted search or an unknown scope.
pub async fn save_search_version(
    pool: &Pool<Sqlite>,
    search_id: &str,
    payload: &str,
    apply_scope: &str,
    identity_version: Option<i64>,
) -> Result<i64> {
    require_object(payload)?;
    if !APPLY_SCOPES.contains(&apply_scope) {
        bail!("apply_scope must be one of {}", APPLY_SCOPES.join(", "));
    }
    let mut tx = pool.begin().await.context("starting a search edit")?;
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM searches WHERE id = ?")
        .bind(search_id)
        .fetch_optional(&mut *tx)
        .await
        .context("reading the search")?;
    match status.as_deref() {
        None => bail!("no search with id {search_id}"),
        Some("deleted") => bail!("a deleted search cannot be edited"),
        Some(_) => {}
    }
    let next: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM search_versions WHERE search_id = ?",
    )
    .bind(search_id)
    .fetch_one(&mut *tx)
    .await
    .context("numbering the search version")?;
    sqlx::query(
        "INSERT INTO search_versions (search_id, version, payload, apply_scope, identity_version) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(search_id)
    .bind(next)
    .bind(payload)
    .bind(apply_scope)
    .bind(identity_version)
    .execute(&mut *tx)
    .await
    .context("appending the search version")?;
    tx.commit().await.context("committing the search edit")?;
    Ok(next)
}

/// Copy a search's latest payload into a new, independent search.
pub async fn duplicate_search(pool: &Pool<Sqlite>, source_id: &str, new_name: &str) -> Result<String> {
    let latest = latest_search_version(pool, source_id)
        .await?
        .with_context(|| format!("no search with id {source_id}"))?;
    create_search(pool, new_name, &latest.payload, None).await
}

/// Pause, resume, or soft-delete a search.
pub async fn set_search_status(pool: &Pool<Sqlite>, search_id: &str, status: &str) -> Result<()> {
    if !SEARCH_STATUSES.contains(&status) {
        bail!("status must be one of {}", SEARCH_STATUSES.join(", "));
    }
    let result = sqlx::query("UPDATE searches SET status = ? WHERE id = ?")
        .bind(status)
        .bind(search_id)
        .execute(pool)
        .await
        .context("updating the search status")?;
    if result.rows_affected() == 0 {
        bail!("no search with id {search_id}");
    }
    Ok(())
}

/// Every search that is not deleted, with its latest version.
pub async fn list_searches(pool: &Pool<Sqlite>) -> Result<Vec<SearchSummary>> {
    let rows = sqlx::query(
        "SELECT s.id, s.name, s.status, v.version, v.payload \
         FROM searches s \
         JOIN search_versions v ON v.search_id = s.id \
          AND v.version = (SELECT MAX(version) FROM search_versions WHERE search_id = s.id) \
         WHERE s.status != 'deleted' \
         ORDER BY s.created_at, s.id",
    )
    .fetch_all(pool)
    .await
    .context("listing searches")?;
    Ok(rows
        .into_iter()
        .map(|row| SearchSummary {
            id: row.get("id"),
            name: row.get("name"),
            status: row.get("status"),
            version: row.get("version"),
            payload: row.get("payload"),
        })
        .collect())
}

/// The latest version of one search, deleted or not.
pub async fn latest_search_version(pool: &Pool<Sqlite>, search_id: &str) -> Result<Option<Versioned>> {
    let row = sqlx::query(
        "SELECT version, payload FROM search_versions WHERE search_id = ? ORDER BY version DESC LIMIT 1",
    )
    .bind(search_id)
    .fetch_optional(pool)
    .await
    .context("reading the search version")?;
    Ok(row.map(|row| Versioned { version: row.get("version"), payload: row.get("payload") }))
}

/// Every version of one search, oldest first.
pub async fn search_history(pool: &Pool<Sqlite>, search_id: &str) -> Result<Vec<Versioned>> {
    let rows = sqlx::query("SELECT version, payload FROM search_versions WHERE search_id = ? ORDER BY version")
        .bind(search_id)
        .fetch_all(pool)
        .await
        .context("reading the search history")?;
    Ok(rows
        .into_iter()
        .map(|row| Versioned { version: row.get("version"), payload: row.get("payload") })
        .collect())
}

/// Whether the first-run wizard has been completed.
pub async fn onboarding_complete(pool: &Pool<Sqlite>) -> Result<bool> {
    let completed: Option<Option<String>> =
        sqlx::query_scalar("SELECT completed_at FROM onboarding_state WHERE id = 1")
            .fetch_optional(pool)
            .await
            .context("reading onboarding state")?;
    Ok(matches!(completed, Some(Some(_))))
}

/// Mark the first-run wizard as completed. Repeating it keeps the first timestamp.
pub async fn mark_onboarding_complete(pool: &Pool<Sqlite>) -> Result<()> {
    sqlx::query(
        "INSERT INTO onboarding_state (id, completed_at) VALUES (1, datetime('now')) \
         ON CONFLICT(id) DO UPDATE SET completed_at = COALESCE(onboarding_state.completed_at, excluded.completed_at)",
    )
    .execute(pool)
    .await
    .context("marking onboarding complete")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn store() -> (tempfile::TempDir, Pool<Sqlite>) {
        let dir = tempdir().expect("temp dir");
        let pool = crate::open_database(&dir.path().join("spike.sqlite")).await.expect("open");
        (dir, pool)
    }

    #[tokio::test]
    async fn identity_edits_append_and_the_older_version_stays_readable() {
        let (_dir, pool) = store().await;
        let first = save_identity(&pool, r#"{"headline":"Backend"}"#).await.expect("first");
        let second = save_identity(&pool, r#"{"headline":"Backend and desktop"}"#).await.expect("second");
        assert!(second > first, "a new identity version gets a new number");

        let current = current_identity(&pool).await.expect("read").expect("present");
        assert_eq!(current.version, second);
        assert_eq!(current.payload, r#"{"headline":"Backend and desktop"}"#);
    }

    #[tokio::test]
    async fn a_search_edit_appends_a_version_and_history_is_not_rewritten() {
        let (_dir, pool) = store().await;
        let id = create_search(&pool, "Remote Rust", r#"{"remote_modes":["remote"]}"#, None)
            .await
            .expect("create");
        let v1 = latest_search_version(&pool, &id).await.expect("read").expect("v1");
        assert_eq!(v1.version, 1);

        let v2 = save_search_version(&pool, &id, r#"{"remote_modes":["remote","hybrid"]}"#, "new_only", None)
            .await
            .expect("edit");
        assert_eq!(v2, 2);

        let history = search_history(&pool, &id).await.expect("history");
        assert_eq!(history.len(), 2, "both versions survive");
        assert_eq!(history[0].payload, r#"{"remote_modes":["remote"]}"#, "v1 is not rewritten");
        assert_eq!(history[1].payload, r#"{"remote_modes":["remote","hybrid"]}"#);
    }

    #[tokio::test]
    async fn a_payload_that_is_not_a_json_object_is_refused_and_nothing_is_stored() {
        let (_dir, pool) = store().await;
        assert!(save_identity(&pool, "[1,2]").await.is_err(), "an array is not a profile");
        assert!(save_identity(&pool, "not json").await.is_err());
        assert!(current_identity(&pool).await.expect("read").is_none(), "nothing was written");
    }

    #[tokio::test]
    async fn an_unknown_apply_scope_is_refused() {
        let (_dir, pool) = store().await;
        let id = create_search(&pool, "Freelance", r#"{}"#, None).await.expect("create");
        let result = save_search_version(&pool, &id, r#"{}"#, "everywhere", None).await;
        assert!(result.is_err(), "the scope must be one of the three the UI offers");
        assert_eq!(search_history(&pool, &id).await.expect("history").len(), 1, "no version appended");
    }

    #[tokio::test]
    async fn duplicating_a_search_gives_an_independent_search_with_its_own_history() {
        let (_dir, pool) = store().await;
        let original = create_search(&pool, "Senior", r#"{"seniority":"senior"}"#, None).await.expect("create");
        let copy = duplicate_search(&pool, &original, "Senior copy").await.expect("duplicate");
        assert_ne!(copy, original);

        save_search_version(&pool, &copy, r#"{"seniority":"lead"}"#, "new_only", None).await.expect("edit copy");
        let original_now = latest_search_version(&pool, &original).await.expect("read").expect("present");
        assert_eq!(original_now.payload, r#"{"seniority":"senior"}"#, "editing the copy leaves the original alone");
    }

    #[tokio::test]
    async fn pausing_keeps_a_search_listed_and_deleting_hides_it_but_keeps_its_history() {
        let (_dir, pool) = store().await;
        let id = create_search(&pool, "Contract", r#"{}"#, None).await.expect("create");

        set_search_status(&pool, &id, "paused").await.expect("pause");
        let listed = list_searches(&pool).await.expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].status, "paused");

        set_search_status(&pool, &id, "deleted").await.expect("delete");
        assert!(list_searches(&pool).await.expect("list").is_empty(), "a deleted search leaves the list");
        assert_eq!(search_history(&pool, &id).await.expect("history").len(), 1, "its history is kept");
    }

    #[tokio::test]
    async fn a_deleted_search_cannot_be_edited() {
        let (_dir, pool) = store().await;
        let id = create_search(&pool, "Old", r#"{}"#, None).await.expect("create");
        set_search_status(&pool, &id, "deleted").await.expect("delete");
        assert!(save_search_version(&pool, &id, r#"{}"#, "new_only", None).await.is_err());
    }

    #[tokio::test]
    async fn onboarding_starts_incomplete_and_is_marked_once() {
        let (_dir, pool) = store().await;
        assert!(!onboarding_complete(&pool).await.expect("read"));
        mark_onboarding_complete(&pool).await.expect("mark");
        assert!(onboarding_complete(&pool).await.expect("read"));
    }
}
