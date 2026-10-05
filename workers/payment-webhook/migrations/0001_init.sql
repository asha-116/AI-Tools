-- Captured Razorpay payments. No name, email or phone is stored: only an HMAC of the email,
-- so a buyer can prove the purchase is theirs when claiming the download.
CREATE TABLE IF NOT EXISTS orders (
  payment_id TEXT PRIMARY KEY,          -- Razorpay payment ID (pay_...); makes webhooks idempotent
  product_id TEXT,                      -- products/catalog.json id; NULL = unmatched, needs support
  amount_paise INTEGER NOT NULL,
  email_hash TEXT,                      -- HMAC-SHA256(HASH_SECRET, "email|" + lower-cased email)
  event_id TEXT,                        -- X-Razorpay-Event-Id of the first delivery
  created_at TEXT NOT NULL
);

-- Per-client claim counters. `key` is an HMAC of the client IP + hour, never the raw IP.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
