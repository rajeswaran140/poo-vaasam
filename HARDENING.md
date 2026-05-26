# Poo Vaasam — Hardening & DevOps Runbook

This is the prioritized checklist for taking the app from its current **dev stage**
to a production-ready posture. It covers (a) follow-ups created by the
2026-05-26 security/code audit, and (b) infrastructure/operational gaps that
cannot be executed from the repo and require AWS Console / IaC access.

Status legend: ✅ done in repo · 🔧 config/infra action required · 📝 future work

---

## What the 2026-05-26 audit already fixed (in repo)

- ✅ **API auth bypass closed.** `src/lib/auth-helper.ts` now verifies the Cognito
  **ID-token JWT** (signature, issuer, audience, expiry) with `aws-jwt-verify`,
  instead of only checking that a Cognito-shaped cookie existed. Forged cookies
  are rejected. Fails closed if the verifier is unconfigured.
- ✅ **RBAC implemented.** `isAdmin()` checks Cognito groups + an `ADMIN_EMAILS`
  allow-list. `requireAdmin()` is wired into `/api/admin/*` and the test route.
- ✅ **Test/seed route locked down in production.** `/api/test/content` returns
  404 when `NODE_ENV=production`.
- ✅ **Content-Security-Policy** header added in `next.config.ts` (joins the
  existing HSTS / X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy).
- ✅ **Sensitive logging removed** from the auth path (no more per-request email /
  cookie-name logging).
- ✅ **Non-breaking dependency advisories patched** (`npm audit fix`: 41 → 36).

---

## P0 — Required before any production launch

### 1. Configure RBAC 🔧
With no admin group and no `ADMIN_EMAILS`, `isAdmin()` **fails closed in
production** (denies everyone) — so the admin portal will not work in prod until
you do one of:
- Create a Cognito group named `admin` (or `administrators`) and add admin users, **or**
- Set `ADMIN_EMAILS="you@tamilagaval.com,other@..."` as an Amplify env var.
Verify post-deploy that an admin can reach `/admin` and a non-admin gets 403 from `/api/admin/*`.

### 2. Rotate & relocate secrets 🔧
> Tracked separately as an accepted dev-stage risk. **This is the pre-prod trigger to resolve it.**

The Amplify app stores production secrets as **plaintext env vars**, and the
AWS access key was additionally mirrored into `NEXT_PUBLIC_*` (shipped to the
browser bundle). Before launch:
- Rotate the AWS IAM access key; audit CloudTrail for prior usage.
- Rotate `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`; regenerate the Google TTS service-account key.
- **Remove all `NEXT_PUBLIC_*AWS*` vars** — route AWS calls through SSR/server actions only.
- Move secrets to AWS Secrets Manager and reference them; do not use plaintext Amplify env vars.

### 3. Verify the live login + auth flow 🔧
Because the auth model changed, smoke-test on the deployed URL:
- Log in via Cognito → confirm `/admin` loads and `/api/admin/content` returns data.
- Confirm a request with no/expired/garbage `...idToken` cookie gets 401.
- Confirm the JWKS fetch succeeds from the SSR runtime (no outbound-network block).

---

## P1 — Strongly recommended

### 4. Clear remaining dependency vulnerabilities 📝
The 36 residual advisories are transitive deps of **`aws-amplify` v5**
(`@aws-sdk/client-polly|rekognition|textract|personalize-events` → old
`middleware-retry`). Clearing them requires the **aws-amplify v5 → v6 migration**
(`npm audit fix --force` will attempt this and *will* break the v5 Auth/UI APIs).
Plan it as a dedicated change; re-run `npm audit` after.

### 5. Production error & uptime monitoring 🔧📝
- Add Sentry (or CloudWatch RUM) for client + server error capture.
- The app already exposes **`/api/health`** — wire it to UptimeRobot/Pingdom/CloudWatch Synthetics.
- Add CloudWatch alarms on Lambda/SSR error rate and p95 latency.

### 6. CSP nonce hardening 📝
The current CSP intentionally allows `script-src 'unsafe-inline' 'unsafe-eval'`
(needed by Next's inline bootstrap + `next dev` HMR). Harden to a per-request
**nonce** strategy via middleware to drop `unsafe-inline` for scripts.

### 7. Finish the `console.*` → `logger` migration 📝
The auth path is clean, but ~100 `console.*` calls remain across ~47 files. Route
them through `src/lib/logger.ts` (env-aware, structured) so prod logs are
consistent and never leak request data.

---

## P2 — Resilience / scale (infra)

- **DynamoDB**: enable Point-in-Time Recovery (PITR); confirm on-demand billing.
- **Backups**: scheduled exports of the table + S3 lifecycle (Glacier) policy.
- **CDN**: front static/media with CloudFront (cache + TLS + origin shielding).
- **Multi-region / DR**: single-region today is a SPOF; document RTO/RPO and a failover plan.
- **Rate limiting / WAF**: add AWS WAF rate-based rules (or Amplify/CloudFront throttling) on `/api/*`.
- **Deployment safety**: enable Amplify branch previews + a rollback/redeploy runbook.

---

## CI (not yet added)

A lightweight pipeline would catch regressions before deploy. Suggested gates on
every push/PR (mirrors what the audit ran locally):

```
npm ci --legacy-peer-deps
npx tsc --noEmit
npx next lint
npm test            # jest — 420 tests
npm audit --omit=dev   # report-only; fail on new high/critical
# optional: npm run test:e2e (Playwright) on a preview URL
```

---

_Last updated: 2026-05-26 (post security/code audit)._
