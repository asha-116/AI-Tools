# workers/ — Cloudflare Workers

- `waitlist/` (Phase 1) — `POST /api/waitlist`: validates, rate-limits (HMAC of IP, never the
  raw IP), drops honeypot hits, stores email + idea + language in D1. See ADR-016.
- `payment-webhook/` (Phase 3, Worker `toolshop-payments`) — `POST /api/razorpay/webhook`:
  verifies the Razorpay signature, records each payment once (D1 `toolshop-orders`, email stored
  only as an HMAC). `POST /api/claim`: payment ID + email → signed download links (≤ 72 h).
- `download/` (Phase 3, Worker `toolshop-download`) — `GET /d/<token>`: checks the signed,
  expiring token and streams the file from the private R2 bucket `toolshop-products`.
- `lib/` — code shared by the Workers: WebCrypto helpers, download tokens, product catalog.

How they fit together: ADR-023 and `docs/ARCHITECTURE.md` §3. Setup: `docs/SETUP.md` §6.
Logs never contain emails, phone numbers or download tokens.
