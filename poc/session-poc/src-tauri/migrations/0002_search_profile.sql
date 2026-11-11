-- Versioned candidate identity and search configuration.
--
-- Every change appends a row; nothing is updated in place. A run keeps the version it
-- ran with, so historical results stay explainable after the user edits a search.

CREATE TABLE IF NOT EXISTS identity_versions (
    version    INTEGER PRIMARY KEY AUTOINCREMENT,
    payload    TEXT    NOT NULL CHECK (json_valid(payload)),
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS searches (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('active', 'paused', 'deleted')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS search_versions (
    search_id        TEXT    NOT NULL REFERENCES searches (id),
    version          INTEGER NOT NULL,
    payload          TEXT    NOT NULL CHECK (json_valid(payload)),
    apply_scope      TEXT    NOT NULL CHECK (apply_scope IN ('new_only', 'active_searches', 'all_future')),
    identity_version INTEGER REFERENCES identity_versions (version),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (search_id, version)
);

-- A single row: whether the first-run wizard has been completed.
CREATE TABLE IF NOT EXISTS onboarding_state (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    completed_at TEXT
);
