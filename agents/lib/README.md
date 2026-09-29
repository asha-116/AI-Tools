# agents/lib — shared agent runtime (Phase 4)

Planned modules:

| Module           | Responsibility                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm.ts`         | OpenAI-compatible chat client; provider fallback from `providers.json`; retry with exponential backoff + jitter on 429/5xx; returns provider + model family used |
| `providers.json` | ordered providers: base URL, env var for key, model, model family, rate limits                                                                                   |
| `budget.ts`      | per-agent daily token budget; hard-stops the run when exceeded; persists usage in the run log                                                                    |
| `redact.ts`      | removes names, phone numbers (+91 formats), emails, Razorpay IDs (`pay_`, `order_`, `rfnd_`), UPI IDs, PAN, Aadhaar-like numbers, addresses; unit-tested         |
| `schema.ts`      | zod validation helper: validate → retry once with the error → escalate                                                                                           |
| `log.ts`         | structured JSON-lines logs to `company/reports/agent-logs/`; scrubs secrets and PII                                                                              |
| `github.ts`      | minimal Issues/PR/label helpers; every write is a no-op under `DRY_RUN=true`                                                                                     |
| `escalate.ts`    | opens a `needs-owner` Issue with context, options and a recommendation                                                                                           |
