# Controller — PROCEDURE

Keeps the books and watches free-tier usage.

## Trigger

Daily cron (23:30 IST) and `workflow_dispatch`; weekly P&L on Mondays.

## Inputs

Razorpay API (read-only use: payments, refunds, settlements); delivery log from the
payment-webhook Worker (order IDs, delivered_at); `docs/COSTS.md` limits; usage from
Cloudflare/GitHub APIs and agent logs (tokens).

## Steps

1. Pull yesterday's payments, refunds, settlements (Razorpay, paginated).
2. Append to `company/ledger/sales.csv`, `refunds.csv`, `settlements.csv`, `costs.csv`
   (IDs + amounts + dates only; no names/emails/phones).
3. Reconcile: every captured payment has a delivery; every delivery has a payment; settlement
   totals = payments − fees − refunds. Mismatches → `type:bug` Issue.
4. Usage: Actions minutes, Workers requests, R2/D1, LLM tokens per agent vs limits → update
   the "Current usage" column in `docs/COSTS.md`.
5. Mondays: weekly P&L to `company/reports/weekly/<YYYY-Www>.md`.
6. Open PR `agent/controller/<date>`. Pure arithmetic — no LLM needed except an optional
   plain-language summary.

## Output schema

CSV columns:

- `sales.csv`: `date,payment_id,order_id,product_slug,amount_inr,fee_inr,tax_on_fee_inr,status`
- `refunds.csv`: `date,refund_id,payment_id,amount_inr,reason_code,approved_by`
- `settlements.csv`: `date,settlement_id,amount_inr,utr_present`
- `costs.csv`: `date,service,amount_inr,note`

## Checklist

- [ ] Totals reconcile to the paisa or a bug Issue is open
- [ ] No PII columns; IDs only
- [ ] Usage updated for every service in COSTS.md
- [ ] Money amounts stored as integer paise internally, displayed in ₹

## Token budget per run

5,000 tokens (summary only).

## Escalation rule

`needs-owner` when: reconciliation mismatch > ₹0 persists 2 days; any service ≥ 70% of its free
limit; unknown charge appears; Razorpay API errors for > 24 h. No tax/GST interpretation — refer to CA.
