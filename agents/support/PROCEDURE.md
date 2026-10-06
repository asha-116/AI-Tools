# Support — PROCEDURE

Answers customer emails from the knowledge base and sends every refund request to the owner.

Code: `src/run.ts` (pipeline), `src/inbox.ts` (inbox adapters), `src/classify.ts`,
`src/kb.ts` (templates), `src/refund.ts` (policy rules), `prompt.md`, `schema.ts`.
Workflow: `.github/workflows/agent-support.yml`.

## Trigger

Every 2 hours at minute 11 (cron) and `workflow_dispatch`, only when the repository variables
`AGENTS_ENABLED == 'true'` and `SUPPORT_INBOX` is set.

## Inputs

- New messages from the support inbox. `SUPPORT_INBOX` (or `--inbox=`): `file:<dir>` reads
  fixture `.eml`/`.json` from a local directory outside git (dry runs, tests). Any other value is
  the real-inbox stub, which opens a `needs-owner` Issue until the owner picks an adapter (Gmail
  API via OAuth, or Cloudflare Email Routing → Worker → D1 queue). No IMAP library (rule 4).
- `company/knowledge-base/` templates (EN + HI), `company/policies/refund-policy.md`
  (the agent threshold is parsed from it; unreadable → ₹0).
- Order lookup by payment ID (`OrderLookup`, Worker API — not built yet; without it refund
  eligibility is "unknown" and the owner checks D1 by hand).

## Steps

1. Fetch new messages (at most 10 per run; the rest wait). Raw text stays **in memory only**.
   Skip a message whose id was already seen in this run (handled once).
2. **Redact** (agents/lib `redact`) subject + body, with the sender's display name as a known
   name, after replacing links with `[LINK]` (download links carry tokens).
3. Language: Devanagari or Hinglish (≥ 2 Hindi words in Latin script) → `hi`, else `en`.
4. Classify the redacted text: LLM (`prompt.md`, zod `ClassificationSchema`, retry once) →
   `download_issue | refund_request | how_to | bug | other`. `classify()` refuses text that
   still contains PII. No provider → deterministic keyword fallback. Invalid output twice →
   `needs-owner` Issue, then keyword fallback.
5. Legal threat / chargeback / fraud, `other`, or confidence < 0.8 → `needs-owner` Issue, no
   automatic reply.
6. Pick the KB **template** (how-to by product). Placeholders such as `{payment_id}` are filled
   locally with `restore()`; template text never goes to the LLM.
7. Refunds: apply the policy deterministically (7 days, once per buyer; broken link not fixed
   in 48 h; double charge). The agent never issues a refund: while the threshold is ₹0 (and
   automatic refunds are not built) **every** request is escalated with a redacted summary
   (masked payment ID `pay_…X7Q2`, message ref, policy findings — no name/email/phone/text).
   The buyer gets the acknowledgement template.
8. Bugs: one redacted `type:bug` Issue per message (deduped by a hidden marker) + acknowledgement.
9. Reply: dry-run → nothing sent, the log records only template id + category. Live → only
   `status: approved` templates are sent; drafts are held and one `needs-owner` Issue lists them.
   Live runs mark the message handled in the inbox.
10. Log one `message.handled` record per message (schema below) — no message or reply text.

## Output schema

```json
{
  "message_ref": "sha256 prefix, hhhhhh.hhhhhh",
  "category": "download_issue|refund_request|how_to|bug|other",
  "language": "en|hi",
  "classifier": "llm|keywords",
  "kb_article": "string|null",
  "template": "string|null",
  "refund": { "eligible": "true|false|null", "amount_inr": "number|null" },
  "action": "reply|refund_and_reply|escalate",
  "outcome": "replied|would_reply|held_unapproved_template|escalated|escalated_and_replied|escalated_would_reply",
  "confidence": 0.0
}
```

## Checklist

- [x] Redaction ran before every LLM call (asserted in `classify()`, tested with a fake LLM)
- [x] Reply is a template from the KB, not free text
- [x] Refunds: never issued by the agent; every request escalated while the threshold is ₹0
- [x] Nothing customer-identifying in logs, Issues or git (tested)
- [x] Same message twice → handled once (tested)

## Token budget per run

10,000 tokens per run; 60,000 per day (about 300 tokens per message).

## Escalation rule

`needs-owner` (with redacted summary only) when: confidence < 0.8 or `other`; every refund
request (threshold ₹0); legal threats, chargebacks, abuse; invalid model output twice; real
inbox not connected; draft templates held in a live run. Any message the KB does not cover twice
in a week → also propose a KB article.
