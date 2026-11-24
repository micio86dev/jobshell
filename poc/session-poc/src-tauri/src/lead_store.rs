//! Storage for the lead pipeline: companies, their evidence, the score, and the user's decisions.
//!
//! The agent writes one JSON document per run; this module is the only reader of it. Two rules
//! are enforced twice, in the agent and here, because a bug in one must not become a wrong claim
//! on screen: a fact that is not an inference needs the page it was read from, and a contact
//! needs the page and the words that show it. An item that breaks the rule is skipped and counted,
//! never stored. Feedback is an append-only log, so any decision can be undone.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::{Pool, Row, Sqlite};

/// The decisions the user can record on a lead. `new` reopens a lead.
pub const EVENTS: [&str; 6] = ["new", "interesting", "not_interesting", "contacted", "later", "converted"];

const PROVENANCES: [&str; 4] = ["verified", "reported", "estimated", "inferred"];
const CHANNELS: [&str; 4] = ["email", "form", "profile", "page"];
const LANGS: [&str; 3] = ["en", "it", "es"];

/// The status of a lead is its latest event, or `new` when the user has not decided yet.
const STATUS_SQL: &str =
    "COALESCE((SELECT event FROM lead_events WHERE lead_id = leads.id ORDER BY id DESC LIMIT 1), 'new')";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IngestSummary {
    pub run_id: String,
    pub leads: usize,
    pub qualified: usize,
    /// Facts and contacts left out because they carried no evidence.
    pub skipped_unevidenced: usize,
    /// Qualified leads the user has not seen qualified before: new companies, and ones that were
    /// rejected until now. This is the number worth a notification.
    pub new_qualified: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct LeadSummary {
    pub id: i64,
    pub company_key: String,
    pub company_name: String,
    pub website: Option<String>,
    pub country: Option<String>,
    pub qualified: bool,
    pub rejection_reason: Option<String>,
    pub score: f64,
    pub confidence: f64,
    pub completeness: f64,
    pub status: String,
    pub summary: String,
    pub why_match: String,
    pub next_action: String,
    pub updated_at: String,
    pub run_id: Option<String>,
    pub signal_count: i64,
    pub contact_count: i64,
    pub draft_count: i64,
}

fn text(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn number(value: &Value, field: &str) -> f64 {
    value.get(field).and_then(Value::as_f64).unwrap_or(0.0)
}

fn items<'a>(value: &'a Value, field: &str) -> &'a [Value] {
    value.get(field).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}

/// Store one run document. Idempotent for a company: a second run updates its lead and evidence
/// and keeps every decision the user recorded.
pub async fn ingest_run(pool: &Pool<Sqlite>, document: &str) -> Result<IngestSummary> {
    let doc: Value = serde_json::from_str(document).context("the run document is not valid JSON")?;
    let run = doc.get("run").context("the run document has no run")?;
    let run_id = text(run, "id").context("the run has no id")?;
    let started_at = text(run, "started_at").context("the run has no start time")?;
    let metrics = run.get("metrics").cloned().unwrap_or_else(|| json!({}));
    let cost = run.get("cost").cloned().unwrap_or_else(|| json!({}));

    let mut tx = pool.begin().await.context("starting the run import")?;
    sqlx::query(
        "INSERT INTO pipeline_runs (id, started_at, finished_at, mode, metrics, cost) VALUES (?, ?, ?, 'leads', ?, ?) \
         ON CONFLICT(id) DO UPDATE SET finished_at = excluded.finished_at, metrics = excluded.metrics, cost = excluded.cost",
    )
    .bind(&run_id)
    .bind(&started_at)
    .bind(text(run, "finished_at"))
    .bind(metrics.to_string())
    .bind(cost.to_string())
    .execute(&mut *tx)
    .await
    .context("storing the run")?;

    let mut summary = IngestSummary { run_id: run_id.clone(), leads: 0, qualified: 0, skipped_unevidenced: 0, new_qualified: 0 };
    for lead in items(&doc, "leads") {
        let key = text(lead, "company_key").context("a lead has no company key")?;
        let name = text(lead, "company_name").context("a lead has no company name")?;
        sqlx::query(
            "INSERT INTO companies (key, name, website, country) VALUES (?, ?, ?, ?) \
             ON CONFLICT(key) DO UPDATE SET name = excluded.name, \
               website = COALESCE(excluded.website, companies.website), \
               country = COALESCE(excluded.country, companies.country), updated_at = datetime('now')",
        )
        .bind(&key)
        .bind(&name)
        .bind(text(lead, "website"))
        .bind(text(lead, "country"))
        .execute(&mut *tx)
        .await
        .context("storing the company")?;

        let score = lead.get("score").cloned().unwrap_or_else(|| json!({}));
        let qualified = lead.get("qualified").and_then(Value::as_bool).unwrap_or(false);
        let was_qualified: Option<i64> = sqlx::query_scalar("SELECT qualified FROM leads WHERE company_key = ?")
            .bind(&key)
            .fetch_optional(&mut *tx)
            .await
            .context("reading the previous state of the lead")?;
        if qualified && was_qualified != Some(1) {
            summary.new_qualified += 1;
        }
        sqlx::query(
            "INSERT INTO leads (company_key, run_id, qualified, rejection_reason, score, confidence, completeness, summary, why_match, next_action) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(company_key) DO UPDATE SET run_id = excluded.run_id, qualified = excluded.qualified, \
               rejection_reason = excluded.rejection_reason, score = excluded.score, confidence = excluded.confidence, \
               completeness = excluded.completeness, summary = excluded.summary, why_match = excluded.why_match, \
               next_action = excluded.next_action, updated_at = datetime('now')",
        )
        .bind(&key)
        .bind(&run_id)
        .bind(i64::from(qualified))
        .bind(text(lead, "rejection_reason"))
        .bind(number(&score, "total"))
        .bind(number(&score, "confidence"))
        .bind(number(&score, "completeness"))
        .bind(text(lead, "summary").unwrap_or_default())
        .bind(text(lead, "why_match").unwrap_or_default())
        .bind(text(lead, "next_action").unwrap_or_default())
        .execute(&mut *tx)
        .await
        .context("storing the lead")?;
        let lead_id: i64 = sqlx::query_scalar("SELECT id FROM leads WHERE company_key = ?")
            .bind(&key)
            .fetch_one(&mut *tx)
            .await
            .context("finding the lead")?;
        summary.leads += 1;
        if qualified {
            summary.qualified += 1;
        }

        sqlx::query("DELETE FROM lead_scores WHERE lead_id = ?").bind(lead_id).execute(&mut *tx).await?;
        for dimension in items(&score, "dimensions") {
            let Some(dimension_name) = text(dimension, "name") else { continue };
            sqlx::query(
                "INSERT INTO lead_scores (lead_id, name, points, max_points, explanation, evidence) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(lead_id)
            .bind(dimension_name)
            .bind(number(dimension, "points"))
            .bind(number(dimension, "max"))
            .bind(text(dimension, "explanation").unwrap_or_default())
            .bind(dimension.get("evidence").cloned().unwrap_or_else(|| json!([])).to_string())
            .execute(&mut *tx)
            .await
            .context("storing a score line")?;
        }

        for signal in items(lead, "signals") {
            let (Some(id), Some(url), Some(title)) = (text(signal, "id"), text(signal, "url"), text(signal, "title")) else {
                continue;
            };
            sqlx::query(
                "INSERT INTO signals (id, company_key, type, source, url, title, quote, published_at, observed_at) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT(id) DO UPDATE SET quote = excluded.quote, title = excluded.title",
            )
            .bind(id)
            .bind(&key)
            .bind(text(signal, "type").unwrap_or_else(|| "job_posting".into()))
            .bind(text(signal, "source").unwrap_or_default())
            .bind(url)
            .bind(title)
            .bind(text(signal, "quote"))
            .bind(text(signal, "published_at"))
            .bind(text(signal, "observed_at").unwrap_or_else(|| started_at.clone()))
            .execute(&mut *tx)
            .await
            .context("storing a signal")?;
        }

        for fact in items(lead, "facts") {
            let (Some(field), Some(value), Some(provenance)) =
                (text(fact, "field"), text(fact, "value"), text(fact, "provenance"))
            else {
                summary.skipped_unevidenced += 1;
                continue;
            };
            let source_url = text(fact, "source_url");
            if !PROVENANCES.contains(&provenance.as_str()) || (provenance != "inferred" && source_url.is_none()) {
                summary.skipped_unevidenced += 1;
                continue;
            }
            sqlx::query(
                "INSERT INTO facts (company_key, field, value, provenance, source_url, quote) VALUES (?, ?, ?, ?, ?, ?) \
                 ON CONFLICT(company_key, field, value) DO UPDATE SET provenance = excluded.provenance, \
                   source_url = excluded.source_url, quote = excluded.quote",
            )
            .bind(&key)
            .bind(field)
            .bind(value)
            .bind(provenance)
            .bind(source_url)
            .bind(text(fact, "quote"))
            .execute(&mut *tx)
            .await
            .context("storing a fact")?;
        }

        for contact in items(lead, "contacts") {
            let (Some(role), Some(channel), Some(value), Some(source_url), Some(quote)) = (
                text(contact, "role"),
                text(contact, "channel"),
                text(contact, "value"),
                text(contact, "source_url"),
                text(contact, "quote"),
            ) else {
                summary.skipped_unevidenced += 1;
                continue;
            };
            if !CHANNELS.contains(&channel.as_str()) {
                summary.skipped_unevidenced += 1;
                continue;
            }
            sqlx::query(
                "INSERT INTO contacts (company_key, role, name, channel, value, source_url, quote, verified) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT(company_key, channel, value) DO UPDATE SET role = excluded.role, name = excluded.name, \
                   source_url = excluded.source_url, quote = excluded.quote, verified = excluded.verified",
            )
            .bind(&key)
            .bind(role)
            .bind(text(contact, "name"))
            .bind(channel)
            .bind(value)
            .bind(source_url)
            .bind(quote)
            .bind(i64::from(contact.get("verified").and_then(Value::as_bool).unwrap_or(false)))
            .execute(&mut *tx)
            .await
            .context("storing a contact")?;
        }

        for draft in items(lead, "outreach") {
            let (Some(lang), Some(subject), Some(body)) = (text(draft, "lang"), text(draft, "subject"), text(draft, "body"))
            else {
                continue;
            };
            if !LANGS.contains(&lang.as_str()) {
                continue;
            }
            sqlx::query(
                "INSERT INTO outreach_drafts (lead_id, lang, subject, body, fact_ids) VALUES (?, ?, ?, ?, ?) \
                 ON CONFLICT(lead_id, lang) DO UPDATE SET subject = excluded.subject, body = excluded.body, \
                   fact_ids = excluded.fact_ids",
            )
            .bind(lead_id)
            .bind(lang)
            .bind(subject)
            .bind(body)
            .bind(draft.get("fact_ids").cloned().unwrap_or_else(|| json!([])).to_string())
            .execute(&mut *tx)
            .await
            .context("storing an outreach draft")?;
        }
    }
    tx.commit().await.context("committing the run import")?;
    Ok(summary)
}

fn summary_of(row: &sqlx::sqlite::SqliteRow) -> LeadSummary {
    LeadSummary {
        id: row.get("id"),
        company_key: row.get("company_key"),
        company_name: row.get("name"),
        website: row.get("website"),
        country: row.get("country"),
        qualified: row.get::<i64, _>("qualified") == 1,
        rejection_reason: row.get("rejection_reason"),
        score: row.get("score"),
        confidence: row.get("confidence"),
        completeness: row.get("completeness"),
        status: row.get("status"),
        summary: row.get("summary"),
        why_match: row.get("why_match"),
        next_action: row.get("next_action"),
        updated_at: row.get("updated_at"),
        run_id: row.get("run_id"),
        signal_count: row.get("signal_count"),
        contact_count: row.get("contact_count"),
        draft_count: row.get("draft_count"),
    }
}

fn select_sql(filter: &str) -> String {
    format!(
        "SELECT leads.id, leads.company_key, companies.name, companies.website, companies.country, leads.qualified, \
         leads.rejection_reason, leads.score, leads.confidence, leads.completeness, {STATUS_SQL} AS status, \
         leads.summary, leads.why_match, leads.next_action, leads.updated_at, leads.run_id, \
         (SELECT COUNT(*) FROM signals WHERE signals.company_key = leads.company_key) AS signal_count, \
         (SELECT COUNT(*) FROM contacts WHERE contacts.company_key = leads.company_key) AS contact_count, \
         (SELECT COUNT(*) FROM outreach_drafts WHERE outreach_drafts.lead_id = leads.id) AS draft_count \
         FROM leads JOIN companies ON companies.key = leads.company_key {filter}"
    )
}

/// The leads of one view, best score first.
///
/// `inbox` is what the main screen shows: qualified leads the user has not dismissed, saved for
/// later or contacted. The other views exist so nothing is lost: `later`, `contacted`, `dismissed`, and
/// `rejected` (analysed, not qualified, with the reason), which belongs to the diagnostics.
pub async fn list_leads(pool: &Pool<Sqlite>, view: &str) -> Result<Vec<LeadSummary>> {
    let filter = match view {
        "inbox" => format!("WHERE leads.qualified = 1 AND {STATUS_SQL} IN ('new', 'interesting')"),
        "later" => format!("WHERE leads.qualified = 1 AND {STATUS_SQL} = 'later'"),
        "contacted" => format!("WHERE {STATUS_SQL} IN ('contacted', 'converted')"),
        "dismissed" => format!("WHERE {STATUS_SQL} = 'not_interesting'"),
        "rejected" => "WHERE leads.qualified = 0".to_string(),
        "all" => String::new(),
        other => bail!("unknown view: {other}"),
    };
    let sql = format!("{} ORDER BY leads.score DESC, leads.id", select_sql(&filter));
    let rows = sqlx::query(&sql).fetch_all(pool).await.context("listing leads")?;
    Ok(rows.iter().map(summary_of).collect())
}

/// One lead with all the evidence behind it, as the detail view shows it.
pub async fn lead_detail(pool: &Pool<Sqlite>, id: i64) -> Result<Option<Value>> {
    let sql = select_sql("WHERE leads.id = ?");
    let Some(row) = sqlx::query(&sql).bind(id).fetch_optional(pool).await.context("reading the lead")? else {
        return Ok(None);
    };
    let lead = summary_of(&row);
    let key = lead.company_key.clone();

    let scores = sqlx::query("SELECT name, points, max_points, explanation, evidence FROM lead_scores WHERE lead_id = ? ORDER BY max_points DESC, name")
        .bind(id)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| {
            let evidence: Value = serde_json::from_str(&r.get::<String, _>("evidence")).unwrap_or(json!([]));
            json!({"name": r.get::<String, _>("name"), "points": r.get::<f64, _>("points"), "max": r.get::<f64, _>("max_points"),
                   "explanation": r.get::<String, _>("explanation"), "evidence": evidence})
        })
        .collect::<Vec<_>>();
    let signals = sqlx::query("SELECT id, type, source, url, title, quote, published_at, observed_at FROM signals WHERE company_key = ? ORDER BY observed_at DESC")
        .bind(&key)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| json!({"id": r.get::<String, _>("id"), "type": r.get::<String, _>("type"), "source": r.get::<String, _>("source"),
                        "url": r.get::<String, _>("url"), "title": r.get::<String, _>("title"), "quote": r.get::<Option<String>, _>("quote"),
                        "published_at": r.get::<Option<String>, _>("published_at")}))
        .collect::<Vec<_>>();
    let facts = sqlx::query("SELECT id, field, value, provenance, source_url, quote FROM facts WHERE company_key = ? ORDER BY field, id")
        .bind(&key)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| json!({"id": r.get::<i64, _>("id"), "field": r.get::<String, _>("field"), "value": r.get::<String, _>("value"),
                        "provenance": r.get::<String, _>("provenance"), "source_url": r.get::<Option<String>, _>("source_url"),
                        "quote": r.get::<Option<String>, _>("quote")}))
        .collect::<Vec<_>>();
    let contacts = sqlx::query("SELECT role, name, channel, value, source_url, quote, verified FROM contacts WHERE company_key = ? ORDER BY verified DESC, id")
        .bind(&key)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| json!({"role": r.get::<String, _>("role"), "name": r.get::<Option<String>, _>("name"), "channel": r.get::<String, _>("channel"),
                        "value": r.get::<String, _>("value"), "source_url": r.get::<String, _>("source_url"), "quote": r.get::<String, _>("quote"),
                        "verified": r.get::<i64, _>("verified") == 1}))
        .collect::<Vec<_>>();
    let drafts = sqlx::query("SELECT lang, subject, body, fact_ids, status FROM outreach_drafts WHERE lead_id = ? ORDER BY lang")
        .bind(id)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| {
            let fact_ids: Value = serde_json::from_str(&r.get::<String, _>("fact_ids")).unwrap_or(json!([]));
            json!({"lang": r.get::<String, _>("lang"), "subject": r.get::<String, _>("subject"), "body": r.get::<String, _>("body"),
                   "fact_ids": fact_ids, "status": r.get::<String, _>("status")})
        })
        .collect::<Vec<_>>();
    let events = sqlx::query("SELECT event, note, at FROM lead_events WHERE lead_id = ? ORDER BY id")
        .bind(id)
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| json!({"event": r.get::<String, _>("event"), "note": r.get::<Option<String>, _>("note"), "at": r.get::<String, _>("at")}))
        .collect::<Vec<_>>();

    Ok(Some(json!({
        "lead": lead, "scores": scores, "signals": signals, "facts": facts,
        "contacts": contacts, "drafts": drafts, "events": events,
    })))
}

/// Record a decision on a lead. Nothing is overwritten: the history stays, and `new` reopens it.
pub async fn record_event(pool: &Pool<Sqlite>, lead_id: i64, event: &str, note: Option<&str>) -> Result<()> {
    if !EVENTS.contains(&event) {
        bail!("an event must be one of {}", EVENTS.join(", "));
    }
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM leads WHERE id = ?")
        .bind(lead_id)
        .fetch_optional(pool)
        .await
        .context("finding the lead")?;
    if exists.is_none() {
        bail!("there is no lead {lead_id}");
    }
    sqlx::query("INSERT INTO lead_events (lead_id, event, note) VALUES (?, ?, ?)")
        .bind(lead_id)
        .bind(event)
        .bind(note.map(str::trim).filter(|n| !n.is_empty()))
        .execute(pool)
        .await
        .context("recording the decision")?;
    Ok(())
}

/// The longest a single look at a lead counts: a window left open is not time spent on the lead.
pub const MAX_REVIEW_SECONDS: i64 = 600;

/// Record how long the user looked at a lead.
pub async fn record_review(pool: &Pool<Sqlite>, lead_id: i64, seconds: i64) -> Result<()> {
    if !(1..=MAX_REVIEW_SECONDS).contains(&seconds) {
        bail!("a review lasts from 1 to {MAX_REVIEW_SECONDS} seconds");
    }
    let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM leads WHERE id = ?")
        .bind(lead_id)
        .fetch_optional(pool)
        .await
        .context("finding the lead")?;
    if exists.is_none() {
        bail!("there is no lead {lead_id}");
    }
    sqlx::query("INSERT INTO lead_reviews (lead_id, seconds) VALUES (?, ?)")
        .bind(lead_id)
        .bind(seconds)
        .execute(pool)
        .await
        .context("recording the review")?;
    Ok(())
}

/// What the user's time bought: seconds spent, leads looked at, leads decided on, and the ones they
/// wanted (interesting, contacted or converted, by their latest decision).
pub async fn effort(pool: &Pool<Sqlite>) -> Result<Value> {
    let (seconds, reviewed): (i64, i64) = sqlx::query_as("SELECT COALESCE(SUM(seconds), 0), COUNT(DISTINCT lead_id) FROM lead_reviews")
        .fetch_one(pool)
        .await
        .context("reading the review time")?;
    let sql = format!(
        "SELECT COALESCE(SUM(CASE WHEN s <> 'new' THEN 1 ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN s IN ('interesting', 'contacted', 'converted') THEN 1 ELSE 0 END), 0) \
         FROM (SELECT {STATUS_SQL} AS s FROM leads WHERE leads.qualified = 1)"
    );
    let (decided, wanted): (i64, i64) = sqlx::query_as(&sql).fetch_one(pool).await.context("reading the decisions")?;
    Ok(json!({"seconds": seconds, "leads_reviewed": reviewed, "decided": decided, "wanted": wanted}))
}

/// For each source that produced a signal of a qualified lead: how many of those leads the user wanted
/// (interesting, contacted or converted, by their latest decision) and how many they did not want.
/// Leads still new, or set aside for later, say nothing and are not counted.
pub async fn source_decisions(pool: &Pool<Sqlite>) -> Result<Vec<(String, i64, i64)>> {
    let sql = format!(
        "SELECT sg.source, \
                COALESCE(SUM(CASE WHEN l.s IN ('interesting', 'contacted', 'converted') THEN 1 ELSE 0 END), 0), \
                COALESCE(SUM(CASE WHEN l.s = 'not_interesting' THEN 1 ELSE 0 END), 0) \
         FROM (SELECT leads.company_key AS k, {STATUS_SQL} AS s FROM leads WHERE leads.qualified = 1) l \
         JOIN (SELECT DISTINCT company_key, source FROM signals) sg ON sg.company_key = l.k \
         GROUP BY sg.source \
         HAVING SUM(CASE WHEN l.s IN ('interesting', 'contacted', 'converted', 'not_interesting') THEN 1 ELSE 0 END) > 0 \
         ORDER BY sg.source"
    );
    sqlx::query_as(&sql).fetch_all(pool).await.context("reading the decisions by source")
}

/// Delete a company and everything held about it: its lead, signals, facts, contacts, drafts and
/// decisions. This is the "forget this company" action.
pub async fn delete_company(pool: &Pool<Sqlite>, key: &str) -> Result<u64> {
    let done = sqlx::query("DELETE FROM companies WHERE key = ?")
        .bind(key)
        .execute(pool)
        .await
        .context("deleting the company")?;
    Ok(done.rows_affected())
}

/// Retention: delete the companies not touched for `days` days that the user has not acted on. A lead
/// the user marked interesting, for later, contacted or converted is theirs and is never purged.
pub async fn purge_older_than(pool: &Pool<Sqlite>, days: u32) -> Result<u64> {
    let sql = format!(
        "DELETE FROM companies WHERE key IN (SELECT company_key FROM leads \
         WHERE updated_at < datetime('now', ?) AND {STATUS_SQL} IN ('new', 'not_interesting'))"
    );
    let done = sqlx::query(&sql)
        .bind(format!("-{days} days"))
        .execute(pool)
        .await
        .context("purging old leads")?;
    Ok(done.rows_affected())
}

/// The latest runs with their funnel and cost, for the diagnostics view.
pub async fn recent_runs(pool: &Pool<Sqlite>, limit: i64) -> Result<Vec<Value>> {
    let rows = sqlx::query("SELECT id, started_at, finished_at, metrics, cost FROM pipeline_runs ORDER BY started_at DESC LIMIT ?")
        .bind(limit.clamp(1, 100))
        .fetch_all(pool)
        .await
        .context("reading the runs")?;
    Ok(rows
        .iter()
        .map(|r| {
            let metrics: Value = serde_json::from_str(&r.get::<String, _>("metrics")).unwrap_or(json!({}));
            let cost: Value = serde_json::from_str(&r.get::<String, _>("cost")).unwrap_or(json!({}));
            json!({"id": r.get::<String, _>("id"), "started_at": r.get::<String, _>("started_at"),
                   "finished_at": r.get::<Option<String>, _>("finished_at"), "metrics": metrics, "cost": cost})
        })
        .collect())
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

    fn lead(key: &str, name: &str, total: f64, qualified: bool) -> Value {
        json!({
            "company_key": key, "company_name": name, "website": "https://acme.test", "country": "DE",
            "qualified": qualified, "rejection_reason": if qualified { Value::Null } else { json!("score below the gate") },
            "summary": "Growing SaaS with one open senior role", "why_match": "Laravel and Vue", "next_action": "Write to the CTO",
            "score": {"total": total, "confidence": 0.8, "completeness": 0.6, "dimensions": [
                {"name": "b2b_potential", "points": 18.0, "max": 25.0, "explanation": "contractor-friendly wording", "evidence": ["s1"]},
                {"name": "technical_relevance", "points": 17.0, "max": 20.0, "explanation": "Laravel and Vue named", "evidence": ["s1"]}]},
            "signals": [{"id": "s1", "type": "job_posting", "source": "lever", "url": "https://jobs.lever.co/acme/1",
                         "title": "Senior Laravel Developer", "quote": "Laravel, Vue", "observed_at": "2026-11-24T10:00:00Z"}],
            "facts": [
                {"field": "funding", "value": "Series A, 8M EUR", "provenance": "reported", "source_url": "https://news.test/acme", "quote": "raised 8M"},
                {"field": "fit", "value": "likely needs extra capacity", "provenance": "inferred"}],
            "contacts": [{"role": "CTO", "name": "Jo Doe", "channel": "profile", "value": "https://profiles.test/jo",
                          "source_url": "https://acme.test/team", "quote": "Jo Doe, CTO", "verified": true}],
            "outreach": [{"lang": "en", "subject": "Laravel capacity", "body": "Hello", "fact_ids": ["funding"]}]
        })
    }

    fn document(run: &str, leads: Vec<Value>) -> String {
        json!({"run": {"id": run, "started_at": "2026-11-24T10:00:00Z", "metrics": {"fetched": 10}, "cost": {"usd": 0.4}}, "leads": leads}).to_string()
    }

    #[tokio::test]
    async fn a_run_is_stored_with_its_evidence_and_the_inbox_shows_only_the_qualified_lead() {
        let (_dir, pool) = store().await;
        let summary = ingest_run(&pool, &document("r1", vec![lead("n:acme", "Acme", 78.0, true), lead("n:globex", "Globex", 31.0, false)]))
            .await
            .expect("ingest");
        assert_eq!((summary.leads, summary.qualified, summary.skipped_unevidenced), (2, 1, 0));

        let inbox = list_leads(&pool, "inbox").await.expect("inbox");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].company_name, "Acme");
        assert_eq!((inbox[0].signal_count, inbox[0].contact_count, inbox[0].draft_count), (1, 1, 1));
        assert_eq!(inbox[0].status, "new");

        let rejected = list_leads(&pool, "rejected").await.expect("rejected");
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].rejection_reason.as_deref(), Some("score below the gate"));

        let detail = lead_detail(&pool, inbox[0].id).await.expect("detail").expect("present");
        assert_eq!(detail["scores"].as_array().map(Vec::len), Some(2));
        assert_eq!(detail["facts"].as_array().map(Vec::len), Some(2));
        assert_eq!(detail["contacts"][0]["source_url"], "https://acme.test/team");
        assert_eq!(detail["drafts"][0]["status"], "draft");
    }

    #[tokio::test]
    async fn a_run_counts_the_qualified_leads_that_are_new_to_the_user_and_a_repeat_adds_none() {
        let (_dir, pool) = store().await;
        let first = ingest_run(&pool, &document("r1", vec![lead("n:acme", "Acme", 70.0, true), lead("n:globex", "Globex", 30.0, false)])).await.expect("first");
        assert_eq!(first.new_qualified, 1, "a rejected company is not news");
        let again = ingest_run(&pool, &document("r2", vec![lead("n:acme", "Acme", 75.0, true), lead("n:initech", "Initech", 80.0, true)])).await.expect("second");
        assert_eq!(again.new_qualified, 1, "only Initech is new");
        let upgraded = ingest_run(&pool, &document("r3", vec![lead("n:globex", "Globex", 66.0, true)])).await.expect("third");
        assert_eq!(upgraded.new_qualified, 1, "a company that was rejected before and now qualifies is news");
    }

    #[tokio::test]
    async fn a_second_run_updates_the_lead_and_keeps_the_decision_the_user_recorded() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:acme", "Acme", 60.0, true)])).await.expect("first");
        let id = list_leads(&pool, "all").await.expect("all")[0].id;
        record_event(&pool, id, "contacted", Some("sent a note by hand")).await.expect("event");

        ingest_run(&pool, &document("r2", vec![lead("n:acme", "Acme", 82.0, true)])).await.expect("second");
        let after = list_leads(&pool, "all").await.expect("all");
        assert_eq!(after.len(), 1, "one lead per company");
        assert_eq!(after[0].score, 82.0);
        assert_eq!(after[0].status, "contacted");
        assert_eq!(after[0].run_id.as_deref(), Some("r2"));
        assert_eq!(list_leads(&pool, "contacted").await.expect("contacted").len(), 1);
        assert_eq!(list_leads(&pool, "inbox").await.expect("inbox").len(), 0);
    }

    #[tokio::test]
    async fn feedback_is_an_append_only_log_and_new_reopens_a_lead() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:acme", "Acme", 70.0, true)])).await.expect("ingest");
        let id = list_leads(&pool, "inbox").await.expect("inbox")[0].id;

        record_event(&pool, id, "not_interesting", None).await.expect("dismiss");
        assert_eq!(list_leads(&pool, "inbox").await.expect("inbox").len(), 0);
        assert_eq!(list_leads(&pool, "dismissed").await.expect("dismissed").len(), 1);

        record_event(&pool, id, "new", Some("changed my mind")).await.expect("reopen");
        assert_eq!(list_leads(&pool, "inbox").await.expect("inbox").len(), 1);

        record_event(&pool, id, "later", None).await.expect("later");
        assert_eq!(list_leads(&pool, "later").await.expect("later").len(), 1);

        let detail = lead_detail(&pool, id).await.expect("detail").expect("present");
        let events: Vec<&str> = detail["events"].as_array().expect("events").iter().filter_map(|e| e["event"].as_str()).collect();
        assert_eq!(events, vec!["not_interesting", "new", "later"], "nothing was overwritten");
    }

    #[tokio::test]
    async fn an_unknown_event_or_an_unknown_lead_is_refused() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:acme", "Acme", 70.0, true)])).await.expect("ingest");
        let id = list_leads(&pool, "all").await.expect("all")[0].id;
        assert!(record_event(&pool, id, "sent", None).await.is_err());
        assert!(record_event(&pool, id + 99, "interesting", None).await.is_err());
        assert!(list_leads(&pool, "everything").await.is_err());
    }

    #[tokio::test]
    async fn a_fact_or_a_contact_without_evidence_is_skipped_and_counted_never_stored() {
        let (_dir, pool) = store().await;
        let mut bad = lead("n:acme", "Acme", 70.0, true);
        bad["facts"] = json!([
            {"field": "revenue", "value": "50M EUR", "provenance": "verified"},
            {"field": "revenue", "value": "big", "provenance": "guess", "source_url": "https://x.test"},
            {"field": "fit", "value": "maybe", "provenance": "inferred"}]);
        bad["contacts"] = json!([
            {"role": "CTO", "channel": "email", "value": "cto@acme.test", "source_url": "https://acme.test", "verified": true},
            {"role": "CEO", "channel": "carrier-pigeon", "value": "x", "source_url": "https://acme.test", "quote": "q"}]);
        let summary = ingest_run(&pool, &document("r1", vec![bad])).await.expect("ingest");
        assert_eq!(summary.skipped_unevidenced, 4);
        let detail = lead_detail(&pool, list_leads(&pool, "all").await.expect("all")[0].id).await.expect("d").expect("p");
        assert_eq!(detail["facts"].as_array().map(Vec::len), Some(1), "only the inference stays");
        assert_eq!(detail["contacts"].as_array().map(Vec::len), Some(0));
    }

    #[tokio::test]
    async fn the_database_itself_refuses_an_unevidenced_fact_and_a_draft_that_is_not_a_draft() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:acme", "Acme", 70.0, true)])).await.expect("ingest");
        let id = list_leads(&pool, "all").await.expect("all")[0].id;
        assert!(sqlx::query("INSERT INTO facts (company_key, field, value, provenance) VALUES ('n:acme', 'revenue', '1M', 'verified')")
            .execute(&pool).await.is_err());
        assert!(sqlx::query("UPDATE outreach_drafts SET status = 'sent' WHERE lead_id = ?").bind(id).execute(&pool).await.is_err());
    }

    #[tokio::test]
    async fn forgetting_a_company_removes_everything_held_about_it() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:acme", "Acme", 70.0, true), lead("n:globex", "Globex", 66.0, true)]))
            .await
            .expect("ingest");
        assert_eq!(delete_company(&pool, "n:acme").await.expect("delete"), 1);
        for table in ["leads", "signals", "facts", "contacts"] {
            let left: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE company_key = 'n:acme'"))
                .fetch_one(&pool)
                .await
                .expect("count");
            assert_eq!(left, 0, "{table} still holds the company");
        }
        // Its drafts, scores and decisions go with the lead; the other company keeps its own.
        let drafts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM outreach_drafts").fetch_one(&pool).await.expect("drafts");
        assert_eq!(drafts, 1);
        assert_eq!(list_leads(&pool, "all").await.expect("all").len(), 1);
    }

    #[tokio::test]
    async fn retention_purges_old_untouched_leads_and_keeps_the_ones_the_user_acted_on() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:old", "Old", 60.0, true), lead("n:acted", "Acted", 60.0, true), lead("n:fresh", "Fresh", 60.0, true)]))
            .await
            .expect("ingest");
        sqlx::query("UPDATE leads SET updated_at = datetime('now', '-200 days') WHERE company_key IN ('n:old', 'n:acted')")
            .execute(&pool).await.expect("age");
        let acted = list_leads(&pool, "all").await.expect("all").into_iter().find(|l| l.company_key == "n:acted").expect("acted").id;
        record_event(&pool, acted, "contacted", None).await.expect("event");
        let later = list_leads(&pool, "all").await.expect("all").into_iter().find(|l| l.company_key == "n:fresh").expect("fresh").id;
        record_event(&pool, later, "later", None).await.expect("later");
        sqlx::query("UPDATE leads SET updated_at = datetime('now', '-200 days') WHERE company_key = 'n:fresh'").execute(&pool).await.expect("age");

        assert_eq!(purge_older_than(&pool, 90).await.expect("purge"), 1, "only the untouched one goes");
        let left: Vec<String> = list_leads(&pool, "all").await.expect("all").into_iter().map(|l| l.company_key).collect();
        assert!(left.contains(&"n:acted".to_string()) && left.contains(&"n:fresh".to_string()) && !left.contains(&"n:old".to_string()));
    }

    #[tokio::test]
    async fn the_time_spent_on_leads_is_counted_against_the_ones_the_user_wanted() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:a", "A", 80.0, true), lead("n:b", "B", 70.0, true), lead("n:c", "C", 65.0, true)])).await.expect("ingest");
        let all = list_leads(&pool, "all").await.expect("all");
        let id = |key: &str| all.iter().find(|l| l.company_key == key).expect(key).id;
        assert_eq!(effort(&pool).await.expect("empty"), json!({"seconds": 0, "leads_reviewed": 0, "decided": 0, "wanted": 0}));

        record_review(&pool, id("n:a"), 90).await.expect("a");
        record_review(&pool, id("n:a"), 30).await.expect("a again");
        record_review(&pool, id("n:b"), 45).await.expect("b");
        record_event(&pool, id("n:a"), "interesting", None).await.expect("wanted");
        record_event(&pool, id("n:b"), "not_interesting", None).await.expect("not wanted");
        // A decision is the latest one: a lead reopened is no longer decided.
        record_event(&pool, id("n:c"), "contacted", None).await.expect("c");
        record_event(&pool, id("n:c"), "new", None).await.expect("reopen");

        assert_eq!(effort(&pool).await.expect("effort"), json!({"seconds": 165, "leads_reviewed": 2, "decided": 2, "wanted": 1}));
    }

    fn from_source(mut lead: Value, source: &str) -> Value {
        let id = format!("s-{}", lead["company_key"].as_str().unwrap_or("x"));
        lead["signals"][0]["id"] = json!(id);
        lead["signals"][0]["source"] = json!(source);
        lead
    }

    #[tokio::test]
    async fn the_decisions_are_counted_by_the_source_that_produced_the_lead() {
        let (_dir, pool) = store().await;
        let leads = vec![
            from_source(lead("n:1", "One", 80.0, true), "hn-hiring"),
            from_source(lead("n:2", "Two", 79.0, true), "hn-hiring"),
            from_source(lead("n:3", "Three", 78.0, true), "hn-hiring"),
            from_source(lead("n:4", "Four", 77.0, true), "yc-hiring"),
            from_source(lead("n:5", "Five", 76.0, true), "yc-hiring"),
            from_source(lead("n:6", "Six", 75.0, false), "yc-hiring"),
            from_source(lead("n:7", "Seven", 74.0, true), "sifted"),
        ];
        ingest_run(&pool, &document("r1", leads)).await.expect("ingest");
        let all = list_leads(&pool, "all").await.expect("all");
        let id = |key: &str| all.iter().find(|l| l.company_key == key).expect(key).id;
        record_event(&pool, id("n:1"), "interesting", None).await.expect("1");
        record_event(&pool, id("n:2"), "converted", None).await.expect("2");
        record_event(&pool, id("n:3"), "not_interesting", None).await.expect("3");
        record_event(&pool, id("n:4"), "not_interesting", None).await.expect("4");
        record_event(&pool, id("n:5"), "later", None).await.expect("5: later says nothing");
        record_event(&pool, id("n:6"), "interesting", None).await.expect("6: not qualified, never counted");
        record_event(&pool, id("n:7"), "contacted", None).await.expect("7a");
        record_event(&pool, id("n:7"), "new", None).await.expect("7b: reopened, says nothing");

        assert_eq!(
            source_decisions(&pool).await.expect("decisions"),
            vec![("hn-hiring".to_string(), 2, 1), ("yc-hiring".to_string(), 0, 1)],
            "a source with no decision at all is absent"
        );
    }

    #[tokio::test]
    async fn a_review_must_be_a_plausible_look_at_a_real_lead() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![lead("n:a", "A", 80.0, true)])).await.expect("ingest");
        let id = list_leads(&pool, "all").await.expect("all")[0].id;
        assert!(record_review(&pool, id, 0).await.is_err());
        assert!(record_review(&pool, id, MAX_REVIEW_SECONDS + 1).await.is_err());
        assert!(record_review(&pool, 9999, 10).await.is_err());
        assert_eq!(effort(&pool).await.expect("effort")["seconds"], json!(0), "nothing was recorded");
        record_review(&pool, id, MAX_REVIEW_SECONDS).await.expect("the longest look");
        record_event(&pool, id, "interesting", None).await.expect("event");
        delete_company(&pool, "n:a").await.expect("forget");
        assert_eq!(effort(&pool).await.expect("after forgetting")["seconds"], json!(0), "reviews go with the lead");
    }

    /// A document the Node pipeline really wrote (the ten scenarios, scripted judge and provider), stored by
    /// the Rust side: the contract between the two languages, not a hand-made shape.
    #[tokio::test]
    async fn a_document_written_by_the_agent_is_stored_whole() {
        let (_dir, pool) = store().await;
        let stored = ingest_run(&pool, include_str!("../tests/fixtures/lead-run.json")).await.expect("ingest");
        assert_eq!((stored.leads, stored.qualified, stored.skipped_unevidenced), (10, 9, 0), "nothing the agent kept is refused here");
        assert_eq!(stored.new_qualified, 9);

        let inbox = list_leads(&pool, "inbox").await.expect("inbox");
        assert_eq!(inbox.len(), 9);
        assert!(inbox.windows(2).all(|pair| pair[0].score >= pair[1].score), "best first");
        let rejected = list_leads(&pool, "rejected").await.expect("rejected");
        assert_eq!(rejected.len(), 1);
        assert!(rejected[0].rejection_reason.as_deref().unwrap_or_default().contains("scheme or vague bait"));

        let first = lead_detail(&pool, inbox[0].id).await.expect("detail").expect("present");
        assert_eq!(first["scores"].as_array().map(Vec::len), Some(6));
        assert!(first["drafts"].as_array().is_some_and(|drafts| drafts.iter().all(|d| d["status"] == "draft")));
        let with_contacts = contacts_stored(&pool, &inbox).await;
        assert!(with_contacts >= 2, "the contacts read on the company pages are stored with their page and quote");
        let runs = recent_runs(&pool, 5).await.expect("runs");
        assert_eq!(runs[0]["metrics"]["qualified"], 9);
    }

    async fn contacts_stored(pool: &Pool<Sqlite>, leads: &[LeadSummary]) -> usize {
        let mut total = 0;
        for lead in leads {
            let detail = lead_detail(pool, lead.id).await.expect("detail").expect("present");
            total += detail["contacts"].as_array().map_or(0, Vec::len);
        }
        total
    }

    #[tokio::test]
    async fn runs_are_listed_newest_first_with_their_funnel_and_cost() {
        let (_dir, pool) = store().await;
        ingest_run(&pool, &document("r1", vec![])).await.expect("one");
        let runs = recent_runs(&pool, 10).await.expect("runs");
        assert_eq!(runs[0]["id"], "r1");
        assert_eq!(runs[0]["metrics"]["fetched"], 10);
        assert_eq!(runs[0]["cost"]["usd"], 0.4);
    }

    #[tokio::test]
    async fn a_document_without_a_run_id_is_refused_and_nothing_is_stored() {
        let (_dir, pool) = store().await;
        assert!(ingest_run(&pool, "not json").await.is_err());
        assert!(ingest_run(&pool, r#"{"run": {"started_at": "x"}, "leads": []}"#).await.is_err());
        assert!(recent_runs(&pool, 10).await.expect("runs").is_empty());
    }
}
