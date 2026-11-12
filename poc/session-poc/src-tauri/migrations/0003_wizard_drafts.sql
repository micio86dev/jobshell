-- Append-only drafts of the onboarding wizard. A partial profile is kept here until it is
-- complete enough to save as an identity version; the newest draft is the one shown back.
CREATE TABLE IF NOT EXISTS wizard_drafts (
    version    INTEGER PRIMARY KEY AUTOINCREMENT,
    payload    TEXT    NOT NULL CHECK (json_valid(payload)),
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
