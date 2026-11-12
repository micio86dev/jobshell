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

/// One stored version: its number, its JSON payload, and for a search version the identity
/// version it was built on (always `None` for an identity version itself).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Versioned {
    pub version: i64,
    pub payload: String,
    pub identity_version: Option<i64>,
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

/// Append a new identity version and carry it to the searches the chosen apply scope reaches.
///
/// `new_only` touches no existing search; `active_searches` appends a version to every
/// active search; `all_future` also reaches paused searches, so a resumed search runs on the
/// new identity. Deleted searches are never touched. Each reached search gets a new version
/// that records the new identity version, and its previous versions stay as they were.
/// The identity and every propagated version are written in one transaction.
pub async fn save_identity_with_scope(pool: &Pool<Sqlite>, payload: &str, apply_scope: &str) -> Result<i64> {
    require_object(payload)?;
    if !APPLY_SCOPES.contains(&apply_scope) {
        bail!("apply_scope must be one of {}", APPLY_SCOPES.join(", "));
    }
    let mut tx = pool.begin().await.context("starting an identity change")?;
    let identity = sqlx::query("INSERT INTO identity_versions (payload) VALUES (?)")
        .bind(payload)
        .execute(&mut *tx)
        .await
        .context("appending an identity version")?
        .last_insert_rowid();

    let statuses: &[&str] = match apply_scope {
        "new_only" => &[],
        "active_searches" => &["active"],
        _ => &["active", "paused"],
    };
    for status in statuses {
        let targets: Vec<String> = sqlx::query_scalar("SELECT id FROM searches WHERE status = ?")
            .bind(status)
            .fetch_all(&mut *tx)
            .await
            .context("finding the searches the identity reaches")?;
        for search_id in targets {
            let latest: String = sqlx::query_scalar(
                "SELECT payload FROM search_versions WHERE search_id = ? ORDER BY version DESC LIMIT 1",
            )
            .bind(&search_id)
            .fetch_one(&mut *tx)
            .await
            .context("reading the search before propagating")?;
            let next: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM search_versions WHERE search_id = ?",
            )
            .bind(&search_id)
            .fetch_one(&mut *tx)
            .await
            .context("numbering the propagated version")?;
            sqlx::query(
                "INSERT INTO search_versions (search_id, version, payload, apply_scope, identity_version) \
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&search_id)
            .bind(next)
            .bind(carry_identity(&latest, payload)?)
            .bind(apply_scope)
            .bind(identity)
            .execute(&mut *tx)
            .await
            .context("appending the propagated version")?;
        }
    }
    tx.commit().await.context("committing the identity change")?;
    Ok(identity)
}

/// The newest identity version, if the user has saved one.
pub async fn current_identity(pool: &Pool<Sqlite>) -> Result<Option<Versioned>> {
    let row = sqlx::query(
        "SELECT version, payload FROM identity_versions ORDER BY version DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .context("reading the identity")?;
    Ok(row.map(|row| Versioned {
        version: row.get("version"),
        payload: row.get("payload"),
        identity_version: None,
    }))
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
        "SELECT version, payload, identity_version FROM search_versions WHERE search_id = ? \
         ORDER BY version DESC LIMIT 1",
    )
    .bind(search_id)
    .fetch_optional(pool)
    .await
    .context("reading the search version")?;
    Ok(row.map(|row| Versioned {
        version: row.get("version"),
        payload: row.get("payload"),
        identity_version: row.get("identity_version"),
    }))
}

/// Every version of one search, oldest first.
pub async fn search_history(pool: &Pool<Sqlite>, search_id: &str) -> Result<Vec<Versioned>> {
    let rows = sqlx::query(
        "SELECT version, payload, identity_version FROM search_versions WHERE search_id = ? ORDER BY version",
    )
    .bind(search_id)
    .fetch_all(pool)
    .await
    .context("reading the search history")?;
    Ok(rows
        .into_iter()
        .map(|row| Versioned {
            version: row.get("version"),
            payload: row.get("payload"),
            identity_version: row.get("identity_version"),
        })
        .collect())
}

/// The search profile the agent reads, with the identity's fields written over it. The identity
/// is authoritative for the keys it contains; keys only the search has are kept as they are.
fn carry_identity(search_payload: &str, identity_payload: &str) -> Result<String> {
    let mut search: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(search_payload).context("reading the search before propagating")?;
    let identity: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(identity_payload).context("reading the identity before propagating")?;
    search.extend(identity);
    Ok(serde_json::Value::Object(search).to_string())
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
    async fn an_identity_change_with_new_only_leaves_existing_searches_untouched() {
        let (_dir, pool) = store().await;
        let identity = save_identity(&pool, r#"{"headline":"Backend"}"#).await.expect("identity");
        let existing = create_search(&pool, "Existing", r#"{}"#, Some(identity)).await.expect("create");

        let new_identity = save_identity_with_scope(&pool, r#"{"headline":"Lead"}"#, "new_only")
            .await
            .expect("change");
        assert!(new_identity > identity);
        assert_eq!(search_history(&pool, &existing).await.expect("history").len(), 1, "no version appended");

        let later = create_search(&pool, "Later", r#"{}"#, Some(new_identity)).await.expect("create later");
        let later_version = latest_search_version(&pool, &later).await.expect("read").expect("present");
        assert_eq!(later_version.version, 1);
    }

    #[tokio::test]
    async fn active_searches_scope_appends_a_version_only_to_active_searches() {
        let (_dir, pool) = store().await;
        let identity = save_identity(&pool, r#"{"headline":"Backend"}"#).await.expect("identity");
        let active = create_search(&pool, "Active", r#"{"remote_modes":["remote"]}"#, Some(identity))
            .await
            .expect("create");
        let paused = create_search(&pool, "Paused", r#"{}"#, Some(identity)).await.expect("create");
        let deleted = create_search(&pool, "Deleted", r#"{}"#, Some(identity)).await.expect("create");
        set_search_status(&pool, &paused, "paused").await.expect("pause");
        set_search_status(&pool, &deleted, "deleted").await.expect("delete");

        let new_identity = save_identity_with_scope(&pool, r#"{"headline":"Lead"}"#, "active_searches")
            .await
            .expect("change");

        let active_history = search_history(&pool, &active).await.expect("history");
        assert_eq!(active_history.len(), 2, "the active search gets a version");
        let propagated = latest_search_version(&pool, &active).await.expect("read").expect("present");
        assert_eq!(propagated.identity_version, Some(new_identity));
        let merged: serde_json::Value = serde_json::from_str(&propagated.payload).expect("json");
        assert_eq!(merged["headline"], "Lead", "the identity field reaches the search profile the agent reads");
        assert_eq!(merged["remote_modes"], serde_json::json!(["remote"]), "a search-only field is kept");
        assert_eq!(search_history(&pool, &paused).await.expect("history").len(), 1, "a paused search is not touched");
        assert_eq!(search_history(&pool, &deleted).await.expect("history").len(), 1, "a deleted search is not touched");
    }

    #[tokio::test]
    async fn all_future_scope_also_reaches_paused_searches_but_never_deleted_ones() {
        let (_dir, pool) = store().await;
        let identity = save_identity(&pool, r#"{"headline":"Backend"}"#).await.expect("identity");
        let paused = create_search(&pool, "Paused", r#"{}"#, Some(identity)).await.expect("create");
        let deleted = create_search(&pool, "Deleted", r#"{}"#, Some(identity)).await.expect("create");
        set_search_status(&pool, &paused, "paused").await.expect("pause");
        set_search_status(&pool, &deleted, "deleted").await.expect("delete");

        let new_identity = save_identity_with_scope(&pool, r#"{"headline":"Lead"}"#, "all_future")
            .await
            .expect("change");

        let propagated = latest_search_version(&pool, &paused).await.expect("read").expect("present");
        assert_eq!(propagated.version, 2, "a paused search resumes on the new identity");
        assert_eq!(propagated.identity_version, Some(new_identity));
        assert_eq!(search_history(&pool, &deleted).await.expect("history").len(), 1, "a deleted search stays as it was");
    }

    #[tokio::test]
    async fn an_identity_change_with_an_unknown_scope_stores_nothing() {
        let (_dir, pool) = store().await;
        let identity = save_identity(&pool, r#"{"headline":"Backend"}"#).await.expect("identity");
        let search = create_search(&pool, "Keep", r#"{}"#, Some(identity)).await.expect("create");

        assert!(save_identity_with_scope(&pool, r#"{"headline":"Lead"}"#, "everywhere").await.is_err());
        assert_eq!(current_identity(&pool).await.expect("read").expect("present").version, identity);
        assert_eq!(search_history(&pool, &search).await.expect("history").len(), 1);
    }

    #[tokio::test]
    async fn onboarding_starts_incomplete_and_is_marked_once() {
        let (_dir, pool) = store().await;
        assert!(!onboarding_complete(&pool).await.expect("read"));
        mark_onboarding_complete(&pool).await.expect("mark");
        assert!(onboarding_complete(&pool).await.expect("read"));
    }
}
