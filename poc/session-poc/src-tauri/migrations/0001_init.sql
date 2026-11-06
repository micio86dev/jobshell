-- Phase 0 spike schema: a task queue that survives process death.
CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT    NOT NULL,
    payload       TEXT    NOT NULL,
    state         TEXT    NOT NULL CHECK (state IN ('queued', 'running', 'done', 'failed', 'interrupted')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    result        TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks (state);

-- Every state transition is recorded, so recovery can be audited after a crash.
CREATE TABLE IF NOT EXISTS task_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    from_state TEXT,
    to_state   TEXT    NOT NULL,
    note       TEXT,
    at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The source registry skeleton that Phase 1 will fill from the Phase 0 catalogue.
CREATE TABLE IF NOT EXISTS sources (
    id               TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    kind             TEXT NOT NULL CHECK (kind IN ('api', 'ats_feed', 'browser', 'community')),
    regions          TEXT NOT NULL,
    languages        TEXT NOT NULL,
    auth_mode        TEXT NOT NULL,
    reuse_policy     TEXT NOT NULL,
    rate_limit       TEXT,
    robots_checked_at TEXT,
    evidence_url     TEXT,
    last_verified_at TEXT
);
