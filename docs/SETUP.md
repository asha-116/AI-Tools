# Setup

Step-by-step setup for a newcomer. Items marked **(owner)** need the owner's accounts, money,
identity or legal authority — agents cannot do them. Tick them as you go.

## Owner checklist (things only the owner can do)

- [ ] Create/confirm the GitHub account that owns this repo
- [ ] Create a Cloudflare account (free plan)
- [ ] Create a Razorpay account; complete **KYC**; add the **bank account** for settlements
- [ ] Generate API keys and store them as GitHub Actions / Cloudflare secrets (§4)
- [ ] Decide repo visibility / branch protection (ADR-009) and apply §3
- [ ] Approve legal pages, prices, brand name, and every social post
- [ ] Decide business registration and **GST** obligations with a Chartered Accountant
      (agents must not give tax advice)
- [ ] Answer "Questions for owner" in `docs/PROGRESS.md`

## 1. Local development

1. Install Node 22 (`nvm install` reads `.nvmrc`).
2. `npm ci`
3. `npm run ci` — must pass before any PR.
4. Copy `.env.example` to `.env` only if you run agents locally; keep `DRY_RUN=true`.
   `.env` is git-ignored — never commit it.

## 2. Accounts (owner)

| Account                               | Plan     | Needed from phase | Notes                                                                    |
| ------------------------------------- | -------- | ----------------- | ------------------------------------------------------------------------ |
| GitHub                                | Free     | 0                 | Enable 2FA.                                                              |
| Cloudflare                            | Free     | 1                 | Enable 2FA. Note the **Account ID** (dashboard sidebar).                 |
| Razorpay                              | Standard | 3                 | Start in **Test Mode**; live mode only after KYC + legal pages approved. |
| Gemini / Groq / Cerebras / OpenRouter | Free     | 4                 | One key each; set spending caps to ₹0 where offered.                     |
| Email provider (e.g. Resend)          | Free     | 3                 | Only if ADR-010 is approved; needs a domain.                             |

## 3. GitHub repository settings (owner)

### 3.1 Labels

Actions → **Sync labels** → _Run workflow_ (after the Phase 0 PR is merged). Creates every
label in `.github/labels.json`.

### 3.2 Actions permissions

Settings → Actions → General:

- _Workflow permissions_: **Read repository contents** (workflows request more explicitly).
- _Allow GitHub Actions to create and approve pull requests_: **off** (agents use a GitHub App, ADR-015).

### 3.3 Branch protection for `main`

Available on public repos (GitHub Free) or private repos on GitHub Pro/Team (ADR-009).

Settings → Rules → Rulesets → _New branch ruleset_:

- Target: default branch (`main`); Enforcement: **Active**; no bypass list except the owner if desired.
- ✅ Restrict deletions; ✅ Block force pushes
- ✅ Require a pull request before merging (1 approval if you add collaborators; 0 if solo —
  you still merge via PR)
- ✅ Require status checks to pass, _require branches to be up to date_:
  - `Lint, typecheck, test, structure`
  - `Secret scan (gitleaks)`
  - `Link check (relative links, offline)`
  - `verifier` (added in Phase 4)
- ✅ Require conversation resolution before merging

If you stay private on GitHub Free, protection is unavailable: rely on agent workflows having
no write access to `main` and never merge red CI yourself.

### 3.4 GitHub App for agents (Phase 4, ADR-015)

Settings (your account) → Developer settings → GitHub Apps → _New GitHub App_: no webhook;
repository permissions **Contents: RW, Pull requests: RW, Issues: RW, Metadata: R**; install it
on this repo only. Save the App ID as variable `AGENT_APP_ID` and the private key as secret
`AGENT_APP_PRIVATE_KEY`.

### 3.5 Projects board

Create a Project (board view) with columns _Backlog → Ready → In progress → In review → Done_,
linked to this repo. Agents add Issues to it (Phase 4).

## 4. Secrets

Names match `.env.example`. **Never** paste a value into an Issue, PR, commit or chat.

| Name                                                                       | Where                                            | Phase                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                                                     | GitHub secret                                    | 1 — token with _Cloudflare Pages: Edit_ (+ _Workers Scripts: Edit_, _D1: Edit_ for workers) |
| `CLOUDFLARE_ACCOUNT_ID`                                                    | GitHub secret                                    | 1                                                                                           |
| `RAZORPAY_WEBHOOK_SECRET`                                                  | Cloudflare Worker secret (`wrangler secret put`) | 3                                                                                           |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`                                  | Worker secret; GitHub secret for Controller      | 3 / 4                                                                                       |
| `DOWNLOAD_SIGNING_KEY`                                                     | Worker secret (both workers); 32+ random bytes   | 3                                                                                           |
| `EMAIL_API_KEY`, `EMAIL_FROM`                                              | Worker secret                                    | 3 (if ADR-010 approved)                                                                     |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY` | GitHub secrets                                   | 4                                                                                           |
| `AGENT_APP_PRIVATE_KEY`                                                    | GitHub secret                                    | 4                                                                                           |
| `SUPPORT_INBOX_TOKEN`                                                      | GitHub secret                                    | 5                                                                                           |

Generate random keys with `openssl rand -base64 48`.

## 5. Deploy (Phase 1+)

Deploys run from `.github/workflows/deploy.yml` on every push to `main` once
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist. First deploy creates the Pages
project; the site is then live at `https://<project>.pages.dev`. Details added in Phase 1.

## 6. Razorpay (Phase 3)

Test mode first. Payment Pages → one page per product; webhook URL = the
`payment-webhook` Worker URL, event `payment.captured`, secret = `RAZORPAY_WEBHOOK_SECRET`.
Details added in Phase 3.
