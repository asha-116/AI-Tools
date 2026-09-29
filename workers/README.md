# workers/ — Cloudflare Workers

- `waitlist/` (Phase 1) — `POST /api/waitlist`: validates, rate-limits (HMAC of IP, never the
  raw IP), drops honeypot hits, stores email + idea + language in D1. See ADR-016.

Phase 3:

- `payment-webhook/` — verifies the Razorpay signature, idempotent on payment ID, issues a
  signed download token (≤ 72 h), emails the buyer.
- `download/` — validates the signed, expiring token and streams the file from R2.
