# workers/ — Cloudflare Workers (Phase 3)

- `payment-webhook/` — verifies the Razorpay signature, idempotent on payment ID, issues a
  signed download token (≤ 72 h), emails the buyer.
- `download/` — validates the signed, expiring token and streams the file from R2.
