# Architecture

"The company is the repo." GitHub holds the work, the memory and the approvals; Cloudflare
serves the storefront and handles payments/delivery; free LLM APIs power the agents.

## 1. System overview

```mermaid
flowchart LR
  subgraph Owner["Owner (board)"]
    O[Reviews PRs, labels approved-by-owner, answers needs-owner Issues]
  end

  subgraph GitHub
    I[Issues + Projects board]
    PR[Pull Requests]
    CI[CI: lint · types · tests · gitleaks · links · QA · Verifier]
    A[Agent heartbeats<br/>scheduled Actions]
    M[(main branch)]
    C[(company/ memory<br/>reports · ledger)]
  end

  subgraph Cloudflare
    P[Pages: static site<br/>calculators run in browser]
    W1[Worker: payment-webhook]
    W2[Worker: download]
    R2[(R2: product files)]
    KV[(D1: orders, waitlist)]
  end

  LLM[Free LLM APIs<br/>Gemini · Groq · OpenRouter · Cerebras]
  RZ[Razorpay<br/>Payment Pages]
  B[Buyer]

  A -->|create/prioritise| I
  A -->|open| PR
  A <-->|redacted prompts only| LLM
  PR --> CI --> O
  O -->|merge| M
  M -->|deploy.yml| P
  M --> C
  B -->|uses free tools| P
  B -->|pays| RZ -->|webhook, signed| W1
  W1 --> KV
  B -->|/get-download/: payment ID + email| W1
  W1 -->|signed links ≤ 72 h| B
  B -->|link| W2 --> R2
  A -->|Controller: read-only API| RZ
```

## 2. Work loop (one agent cycle)

```mermaid
sequenceDiagram
  autonumber
  participant Orc as Orchestrator (daily cron)
  participant GH as GitHub Issues/PRs
  participant Bld as Builder
  participant QA as QA (CI)
  participant Ver as Verifier (other model family)
  participant Own as Owner
  participant CF as Cloudflare Pages
  participant Ctl as Controller (daily cron)

  Orc->>GH: read goals.md, open Issues, last reports
  Orc->>GH: create ≤ 5 prioritised Issues (agent:builder …)
  Orc->>GH: write company/reports/daily/<date>.md (via PR)
  GH-->>Bld: Issue labelled agent:builder
  Bld->>GH: PR on agent/builder/<slug> (tests first)
  GH-->>QA: CI on PR
  GH-->>Ver: PR touches formulas/prices/legal/published text
  QA-->>GH: pass/fail + comment
  Ver-->>GH: required status + comment
  Own->>GH: review + merge
  GH-->>CF: deploy from main
  Ctl->>GH: ledger + usage report
```

## 3. Purchase and delivery (Phase 3, ADR-023)

```mermaid
sequenceDiagram
  autonumber
  participant B as Buyer
  participant RZ as Razorpay Payment Page
  participant WH as Worker: payment-webhook
  participant D1 as D1 (orders)
  participant S as Site: /get-download/
  participant DL as Worker: download
  participant R2 as R2 bucket (private)

  B->>RZ: pay (UPI/card)
  RZ-->>B: receipt email with payment ID
  RZ->>WH: POST payment.captured + X-Razorpay-Signature
  WH->>WH: verify HMAC-SHA256(raw body, webhook secret), reject if invalid
  WH->>WH: product = "product" note or catalog price == amount
  WH->>D1: INSERT payment id, product, amount, HMAC(email) ON CONFLICT DO NOTHING
  WH-->>RZ: 200 (also for duplicates)
  B->>S: payment ID + email
  S->>WH: POST /api/claim (CORS allow-list, 10/IP/hour)
  WH->>D1: find payment, compare HMAC(email)
  WH-->>S: one signed link per file, valid 72 h
  B->>DL: GET /d/<token>
  DL->>DL: verify signature, expiry, file belongs to product
  DL->>R2: get file
  DL-->>B: file (attachment, no-store)
```

## 4. Data flows and trust boundaries

| Data                         | Lives in                              | May go to an LLM?           |
| ---------------------------- | ------------------------------------- | --------------------------- |
| Calculator inputs            | Buyer's browser only                  | Never (never leaves device) |
| Waitlist emails              | Cloudflare D1                         | Never                       |
| Buyer email, name, phone     | Razorpay only; D1 keeps an email HMAC | Never                       |
| Payment/order IDs, amounts   | Razorpay; D1; `company/ledger/*.csv`  | Never                       |
| Support message text         | Support inbox → agent run memory      | Only after redaction        |
| Goals, policies, KB, reports | `company/` in git                     | Yes (no PII by rule)        |
| Secrets                      | GitHub Secrets / Cloudflare env       | Never                       |

## 5. Agent runtime

- Each agent is `agents/<name>/run.ts`, invoked by a workflow in `.github/workflows/`
  (cron + `workflow_dispatch`), running with `tsx` on Node 22.
- Shared code in `agents/lib/`: OpenAI-compatible LLM client with provider fallback
  (`providers.json`), 429 backoff, per-agent daily token budget (hard stop), redaction,
  zod schema validation (invalid → retry once → escalate), structured logs to
  `company/reports/agent-logs/`, `DRY_RUN=true` mode.
- Agents write to the repo **only through PRs**; workflows get least-privilege `permissions:`.
- Verifier always uses a different model family from the producer of the output it checks.

## 6. Why static-first

All calculators are pure functions in `tools-core`, bundled into static pages. No server
means no hosting cost, no user data risk and near-perfect Lighthouse scores. The only server
code is two small Workers for payments and delivery.
