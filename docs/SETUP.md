# Setup

Step-by-step setup for a newcomer. Items marked **(owner)** need the owner's accounts, money,
identity or legal authority — agents cannot do them. Tick them as you go.

## Owner checklist (things only the owner can do)

- [ ] Create/confirm the GitHub account that owns this repo
- [ ] Create a Cloudflare account (free plan)
- [ ] Create a Razorpay account; complete **KYC**; add the **bank account** for settlements
- [ ] Generate API keys and store them as GitHub Actions / Cloudflare secrets (§4)
- [ ] Later (deferred 2026-10-05): set up payments in Razorpay **test mode** and do one test purchase (§6)
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

| Name                                                                       | Where                                          | Phase                                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`                                                     | GitHub secret                                  | 1 — token with _Cloudflare Pages: Edit_ (+ _Workers Scripts: Edit_, _D1: Edit_ for workers) |
| `CLOUDFLARE_ACCOUNT_ID`                                                    | GitHub secret                                  | 1                                                                                           |
| `RAZORPAY_WEBHOOK_SECRET`, `PAYMENTS_HASH_SECRET`, `DOWNLOAD_TOKEN_SECRET` | GitHub secret; Deploy copies it to the Workers | 3 — see §6.2                                                                                |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`                                  | GitHub secret for the Controller (read-only)   | 4 — not needed for Payment Pages                                                            |
| `EMAIL_API_KEY`, `EMAIL_FROM`                                              | Worker secret                                  | 3 (if ADR-010 approved)                                                                     |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY` | GitHub secrets                                 | 4                                                                                           |
| `AGENT_APP_PRIVATE_KEY`                                                    | GitHub secret                                  | 4                                                                                           |
| `SUPPORT_INBOX_TOKEN`                                                      | GitHub secret                                  | 5                                                                                           |

Generate random keys with `openssl rand -base64 48`.

## 5. Deploy the site and waitlist (Phase 1)

`.github/workflows/deploy.yml` runs on every push to `main` (and manually via _Run workflow_).
Each job skips itself with a notice until its settings exist, so nothing fails before setup.

### 5.1 One-time Cloudflare setup (owner, ~15 min)

1. Cloudflare dashboard → _My Profile → API Tokens → Create Token → Custom token_ with:
   **Account · Cloudflare Pages · Edit**, **Account · Workers Scripts · Edit**,
   **Account · D1 · Edit**. Limit it to your account. Copy the token.
2. Note your **Account ID** (Workers & Pages overview, right sidebar).
3. Create the database: _Storage & Databases → D1 → Create_ named `toolshop-waitlist`.
   Copy its **Database ID** (not a secret).
4. Optional: _Analytics & Logs → Web Analytics → Add a site_ (free, cookieless). Copy the token.

### 5.2 GitHub settings (Settings → Secrets and variables → Actions)

| Kind     | Name                      | Value                                                                                                                                                                                                   |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`    | token from 5.1.1                                                                                                                                                                                        |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`   | from 5.1.2                                                                                                                                                                                              |
| Secret   | `WAITLIST_IP_HASH_SECRET` | output of `openssl rand -base64 48`                                                                                                                                                                     |
| Variable | `WAITLIST_D1_ID`          | Database ID from 5.1.3                                                                                                                                                                                  |
| Variable | `PAGES_PROJECT`           | optional, default `toolshop`. **If the name is taken on pages.dev, Cloudflare adds a suffix** (ours: `toolshop-elu.pages.dev`) — read the real address from the Deploy log line “Take a peek over at …” |
| Variable | `SITE_URL`                | the public address, e.g. `https://tools.changelense.in` (used for canonical/share links)                                                                                                                |
| Variable | `SITE_ORIGINS`            | every address the site is opened from, comma-separated, e.g. `https://tools.changelense.in,https://toolshop-elu.pages.dev` — sign-ups from any other address are refused                                |
| Variable | `WAITLIST_URL`            | `https://toolshop-waitlist.<your-subdomain>.workers.dev/api/waitlist` (shown after the first Worker deploy)                                                                                             |
| Variable | `SUPPORT_EMAIL`           | address shown in the privacy note                                                                                                                                                                       |
| Variable | `CF_BEACON_TOKEN`         | optional, from 5.1.4                                                                                                                                                                                    |

### 5.3 First deploy

1. Actions → **Deploy** → _Run workflow_. The Worker job prints its `*.workers.dev` URL.
2. Put that URL (+ `/api/waitlist`) into `WAITLIST_URL`, then run **Deploy** again so the site
   is rebuilt with the form switched on (without it the page shows "waitlist opens soon").
3. Open the site, sign up with your own email, and check it arrived:
   Cloudflare dashboard → D1 → `toolshop-waitlist` → _Console_:
   `SELECT idea, lang, COUNT(*) FROM signups GROUP BY idea, lang;`

**Privacy:** the `signups` table holds email addresses. Never export it into git, Issues or any
LLM prompt. Delete a person on request with
`DELETE FROM signups WHERE email = 'their@email';`.

### 5.4 Custom domain (current: `tools.changelense.in`)

`changelense.in` is on the owner's Cloudflare account, so Pages manages the DNS itself:

1. Workers & Pages → **toolshop** → **Custom domains** → _Set up a custom domain_ →
   `tools.changelense.in` → _Continue_ → **Activate domain**.
2. **Do not add the CNAME in the DNS page yourself first** — Pages then fails with
   “An A, AAAA, or CNAME record with that host already exists” and the site shows
   _Error 523_. If that happens: delete the manual record, remove the pending domain in
   _Custom domains_, and add it again.
3. Wait for **Active** (minutes), then set `SITE_URL` / `SITE_ORIGINS` (5.2) and run **Deploy**.

⚠️ `toolshop.pages.dev` belongs to **someone else** (a gambling site). Never link to it.

### 5.5 Local development

```bash
npm run dev -w @toolshop/site                       # site at http://localhost:4321
cd workers/waitlist
printf 'IP_HASH_SECRET=local-dev-secret\n' > .dev.vars  # git-ignored
npx wrangler@4.143.0 d1 migrations apply toolshop-waitlist --local
npx wrangler@4.143.0 dev --port 8787
# then run the site with PUBLIC_WAITLIST_URL=http://localhost:8787/api/waitlist
```

## 6. Payments and downloads (Phase 3)

How a sale works (ADR-023): the buyer pays on a **Razorpay Payment Page** → Razorpay calls the
**payments Worker** (`workers/payment-webhook`), which records the payment → the buyer opens
**/get-download/** on our site, enters the payment ID from their Razorpay receipt email and
their email → the page shows download links (valid 72 hours, renewable on the same page) served
by the **download Worker** (`workers/download`) from the R2 bucket.

> **Deferred (owner, 2026-10-05):** do this section once business details and prices are
> decided. Until then the Workers stay off and the site shows templates as "coming soon".

Nothing is buyable on the live site until you approve prices and switch products in
`products/catalog.json` from `draft` to `live` (PR labelled `approved-by-owner`).
Always do §6.1–6.5 in **Razorpay test mode** first.

### 6.1 Cloudflare (owner, ~10 min)

1. Edit the API token from §5.1.1 and add **Account · Workers R2 Storage · Edit**.
2. _Storage & Databases → D1 → Create_ named `toolshop-orders`. Copy its **Database ID**.
3. _R2 → Create bucket_ named `toolshop-products` (location: Automatic). Keep it **private**
   (no public access, no custom domain) — files leave it only through the download Worker.

### 6.2 GitHub settings (Settings → Secrets and variables → Actions)

| Kind     | Name                      | Value                                                                                  |
| -------- | ------------------------- | -------------------------------------------------------------------------------------- |
| Secret   | `RAZORPAY_WEBHOOK_SECRET` | any long random string — you type the **same** value into Razorpay in 6.3              |
| Secret   | `PAYMENTS_HASH_SECRET`    | output of `openssl rand -base64 48` (hashes buyer emails and IPs)                      |
| Secret   | `DOWNLOAD_TOKEN_SECRET`   | output of `openssl rand -base64 48` (signs download links; both Workers use it)        |
| Variable | `ORDERS_D1_ID`            | Database ID from 6.1.2                                                                 |
| Variable | `DOWNLOAD_BASE_URL`       | `https://toolshop-download.<your-subdomain>.workers.dev` (printed by the first Deploy) |
| Variable | `ALLOW_DRAFT_PRODUCTS`    | `true` while testing; **delete it (or set `false`) before going live**                 |
| Variable | `CLAIM_URL`               | `https://toolshop-payments.<your-subdomain>.workers.dev/api/claim` (printed by Deploy) |

Run **Deploy**. The first run deploys the download Worker and prints its address; set
`DOWNLOAD_BASE_URL`, then run **Deploy** again so the payments Worker and the site pick it up.

Never change `DOWNLOAD_TOKEN_SECRET` casually: links already sent stop working (buyers can get
new ones on /get-download/).

### 6.3 Razorpay (test mode)

1. Dashboard → switch to **Test Mode**.
2. _Payment Pages → Create_ one page per product in `products/catalog.json` (lead tracker,
   commission ledger, bundle). **Fixed amount** equal to the catalog price (₹199 / ₹299 / ₹399
   while those are drafts). Make **email mandatory**. Optional: add a hidden field `product`
   with the catalog id — the Worker uses it if present, otherwise it matches by amount.
3. Success message / redirect: point buyers to `https://tools.changelense.in/get-download/`
   and tell them the payment ID is in their Razorpay receipt email.
4. _Accounts & Settings → Webhooks → Add new webhook_:
   - URL: `https://toolshop-payments.<your-subdomain>.workers.dev/api/razorpay/webhook`
   - Secret: the value of `RAZORPAY_WEBHOOK_SECRET`
   - Active events: **payment.captured** (and optionally **order.paid**; duplicates are ignored)

### 6.4 Upload the product files

Build the workbooks (English and Hindi) from `products/*/spec.json`, then upload them under the
keys listed in `products/catalog.json`:

```bash
npm run build:templates            # → products/<id>/dist/{en,hi}/<id>.xlsx (git-ignored)
for id in lead-tracker commission-ledger; do
  for lang in en hi; do
    npx wrangler@4.143.0 r2 object put "toolshop-products/$id/v1/$lang/$id.xlsx" \
      --file "products/$id/dist/$lang/$id.xlsx" --remote
  done
done
```

Open each file in Google Sheets and Excel once before selling (checklist in
`products/README.md`).

### 6.5 Test purchase (≈5 min)

1. Open a test Payment Page and pay with Razorpay's **test card / UPI** (shown in their test docs).
2. Cloudflare → Workers → `toolshop-payments` → _Logs_: expect
   `{"evt":"payment_recorded","payment_id":"pay_…","product":"lead-tracker"}`.
   `payment_unmatched` means the amount differs from the catalog; `webhook_rejected` /
   `bad_signature` means the secret in Razorpay ≠ `RAZORPAY_WEBHOOK_SECRET`.
3. Open /get-download/, enter the payment ID from the receipt email + your email → the file
   downloads. In Razorpay, _Webhooks → your webhook → Resend_ an event: logs show
   `payment_duplicate` and nothing changes.
4. Please confirm here (or in the PR) that the logged payload matched — the Worker's parsing of
   Razorpay's payload is based on their published format, which the build environment could
   not open directly.

### 6.6 Going live (owner, later)

Only after: prices approved, legal pages approved (`legal/`), GST/registration advice from a CA,
the test purchase in 6.5 passed. Then: Razorpay **Live Mode** keys/pages/webhook (new webhook,
same Worker URL, same secret or rotate it), products → `live` in the catalog, remove
`ALLOW_DRAFT_PRODUCTS`, Deploy.

### 6.7 Local development

```bash
cd workers/payment-webhook
printf 'RAZORPAY_WEBHOOK_SECRET=whsec_local\nHASH_SECRET=hash_local\nDOWNLOAD_TOKEN_SECRET=dl_local\n' > .dev.vars
npx wrangler@4.143.0 d1 migrations apply toolshop-orders --local
npx wrangler@4.143.0 dev --port 8787 --inspector-port 9331 \
  --var ALLOWED_ORIGINS:http://localhost:4321 --var DOWNLOAD_BASE_URL:http://localhost:8788 \
  --var ALLOW_DRAFT_PRODUCTS:true
# second terminal
cd workers/download && printf 'DOWNLOAD_TOKEN_SECRET=dl_local\n' > .dev.vars
npx wrangler@4.143.0 r2 object put toolshop-products/lead-tracker/v1/en/lead-tracker.xlsx --file ./any.xlsx --local
npx wrangler@4.143.0 dev --port 8788
# site: PUBLIC_CLAIM_URL=http://localhost:8787/api/claim PUBLIC_DOWNLOAD_BASE_URL=http://localhost:8788
```

Send a signed test webhook:

```bash
BODY='{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_LOCAL1","amount":19900,"currency":"INR","status":"captured","email":"me@example.com","notes":[]}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac whsec_local | awk '{print $2}')
curl -X POST http://localhost:8787/api/razorpay/webhook -H 'Content-Type: application/json' \
  -H "X-Razorpay-Signature: $SIG" --data-raw "$BODY"
```
