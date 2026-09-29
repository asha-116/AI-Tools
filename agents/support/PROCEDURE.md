# Support — PROCEDURE

Answers customer emails from the knowledge base and applies the refund policy up to a threshold.

## Trigger

Every 2 hours (cron) and `workflow_dispatch`.

## Inputs

New messages from the support inbox (via forwarding to a parser Worker or IMAP — Phase 5);
`company/knowledge-base/`; `company/policies/refund-policy.md`; order lookup (Worker API, by
order ID only).

## Steps

1. Fetch new messages. Keep raw text **in memory only** — never write it to git or logs.
2. **Redact** (agents/lib `redact.ts`): names, emails, phones, addresses, payment/order IDs,
   UPI IDs, PAN/Aadhaar-like numbers → placeholders like `[EMAIL_1]`.
3. Classify the redacted text (LLM): `download_issue | refund_request | how_to | bug | other`.
4. Answer from the knowledge base with a **template** (placeholders re-filled locally after the LLM call).
5. Refunds: apply `refund-policy.md`. If eligible and amount ≤ threshold → issue via Razorpay
   API (idempotent) and reply. Otherwise escalate.
6. Log: category, template used, outcome, redacted-ID hash — no message text.

## Output schema

```json
{
  "message_ref": "sha256-prefix",
  "category": "download_issue|refund_request|how_to|bug|other",
  "kb_article": "string|null",
  "template": "string",
  "refund": { "eligible": false, "amount_inr": 0 },
  "action": "reply|refund_and_reply|escalate",
  "confidence": 0.0
}
```

## Checklist

- [ ] Redaction ran before every LLM call (asserted in code, tested)
- [ ] Reply is a template from the KB, not free text
- [ ] Refund within threshold and policy; one refund per order (idempotent)
- [ ] Nothing customer-identifying in logs or git

## Token budget per run

10,000 tokens per run; 60,000 per day.

## Escalation rule

`needs-owner` (with redacted summary only) when: confidence < 0.8; refund above threshold or
outside policy; legal threats, chargebacks, abuse; any message the KB does not cover twice in a week (→ also propose a KB article).
