CREATE TABLE IF NOT EXISTS authors (
  id            INTEGER PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT,
  first_seen_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY,
  author_id     INTEGER NOT NULL REFERENCES authors(id),
  spec_name     TEXT NOT NULL,
  spec_path     TEXT,
  tool_context  TEXT,
  trigger_layer INTEGER,
  phase         TEXT NOT NULL DEFAULT 'coaching',
  session_notes TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dimension_scores (
  id            INTEGER PRIMARY KEY,
  session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  dimension_key TEXT NOT NULL,
  score         INTEGER NOT NULL CHECK(score >= 1 AND score <= 10),
  feedback      TEXT,
  UNIQUE(session_id, dimension_key)
);

CREATE TABLE IF NOT EXISTS self_assessments (
  id              INTEGER PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  dimension_key   TEXT NOT NULL,
  predicted_score INTEGER NOT NULL CHECK(predicted_score >= 1 AND predicted_score <= 10),
  actual_score    INTEGER CHECK(actual_score >= 1 AND actual_score <= 10),
  gap             INTEGER,
  UNIQUE(session_id, dimension_key)
);
