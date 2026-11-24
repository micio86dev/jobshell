-- The time the user spends reading a lead, so the client search can be judged by what it was made for:
-- wanted opportunities per hour of the user's time. Additive: nothing existing changes.
CREATE TABLE IF NOT EXISTS lead_reviews (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads (id) ON DELETE CASCADE,
    seconds INTEGER NOT NULL CHECK (seconds BETWEEN 1 AND 600),
    at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lead_reviews_lead ON lead_reviews (lead_id);
