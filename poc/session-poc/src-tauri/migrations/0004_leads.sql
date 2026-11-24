-- The lead pipeline: companies that may buy the user's services, the evidence behind each, and what
-- the user decided. Additive only: no existing table changes.
--
-- Three invariants live in the schema, so no code path can break them:
--   * a fact that is not an inference names the page it was read from;
--   * a contact names the page and the words that show it;
--   * an outreach draft is always a draft: nothing in this app sends it.

CREATE TABLE IF NOT EXISTS companies (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    website    TEXT,
    country    TEXT,
    first_seen TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id          TEXT PRIMARY KEY,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    mode        TEXT NOT NULL DEFAULT 'leads',
    metrics     TEXT NOT NULL CHECK (json_valid(metrics)),
    cost        TEXT NOT NULL CHECK (json_valid(cost)),
    ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company_key      TEXT NOT NULL UNIQUE REFERENCES companies (key) ON DELETE CASCADE,
    run_id           TEXT REFERENCES pipeline_runs (id),
    qualified        INTEGER NOT NULL CHECK (qualified IN (0, 1)),
    rejection_reason TEXT,
    score            REAL NOT NULL,
    confidence       REAL NOT NULL,
    completeness     REAL NOT NULL,
    summary          TEXT NOT NULL DEFAULT '',
    why_match        TEXT NOT NULL DEFAULT '',
    next_action      TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lead_scores (
    lead_id     INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    points      REAL NOT NULL,
    max_points  REAL NOT NULL,
    explanation TEXT NOT NULL,
    evidence    TEXT NOT NULL CHECK (json_valid(evidence)),
    PRIMARY KEY (lead_id, name)
);

CREATE TABLE IF NOT EXISTS signals (
    id           TEXT PRIMARY KEY,
    company_key  TEXT NOT NULL REFERENCES companies (key) ON DELETE CASCADE,
    type         TEXT NOT NULL,
    source       TEXT NOT NULL,
    url          TEXT NOT NULL,
    title        TEXT NOT NULL,
    quote        TEXT,
    published_at TEXT,
    observed_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_key TEXT NOT NULL REFERENCES companies (key) ON DELETE CASCADE,
    field       TEXT NOT NULL,
    value       TEXT NOT NULL,
    provenance  TEXT NOT NULL CHECK (provenance IN ('verified', 'reported', 'estimated', 'inferred')),
    source_url  TEXT,
    quote       TEXT,
    CHECK (provenance = 'inferred' OR source_url IS NOT NULL),
    UNIQUE (company_key, field, value)
);

CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_key TEXT NOT NULL REFERENCES companies (key) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    name        TEXT,
    channel     TEXT NOT NULL CHECK (channel IN ('email', 'form', 'profile', 'page')),
    value       TEXT NOT NULL,
    source_url  TEXT NOT NULL,
    quote       TEXT NOT NULL,
    verified    INTEGER NOT NULL CHECK (verified IN (0, 1)),
    UNIQUE (company_key, channel, value)
);

CREATE TABLE IF NOT EXISTS outreach_drafts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    lang       TEXT NOT NULL CHECK (lang IN ('en', 'it', 'es')),
    subject    TEXT NOT NULL,
    body       TEXT NOT NULL,
    fact_ids   TEXT NOT NULL CHECK (json_valid(fact_ids)),
    status     TEXT NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (lead_id, lang)
);

-- Feedback is an append-only log: the status is the latest event, and 'new' reopens a lead.
CREATE TABLE IF NOT EXISTS lead_events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    event   TEXT NOT NULL CHECK (event IN ('new', 'interesting', 'not_interesting', 'contacted', 'later', 'converted')),
    note    TEXT,
    at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_qualified ON leads (qualified, score);
CREATE INDEX IF NOT EXISTS idx_lead_events_lead ON lead_events (lead_id, id);
CREATE INDEX IF NOT EXISTS idx_signals_company ON signals (company_key);
