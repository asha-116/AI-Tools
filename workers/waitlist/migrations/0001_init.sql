-- Waitlist sign-ups. Email is personal data: never export it to git, logs or an LLM.
CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  idea TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'hi')),
  consent_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (email, idea)
);

-- Per-client request counters. `key` is an HMAC of the client IP + time window, never the raw IP.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
