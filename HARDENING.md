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

## What the 2026-08-20 audit fixed (in repo + via AWS API)

- ✅ **Leaked AWS IAM key rotated and deleted.** `poo-vaasam-app-user`'s access
  key (which had `AmazonDynamoDBFullAccess + AmazonS3FullAccess` — full
  account-wide, not scoped) was rotated to a fresh AKID via `iam
  create-access-key` → Amplify env-var swap → release build → `iam
  delete-access-key`. The prior key was exposed as a plaintext Amplify env var
  readable by anyone with `amplify:GetApp`.
- ✅ **13 sensitive Amplify env vars mirrored into SSM SecureString** at
  `/amplify/d3rkmepk4popv0/master/*` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `APP_AWS_*`, `CRON_SECRET`, `GA4_SERVICE_ACCOUNT_KEY`,
  `GOOGLE_TTS_CREDENTIALS_BASE64`, `LYRICS_GATE_SECRET`, `VAPID_PRIVATE_KEY`,
  `YOUTUBE_API_KEY`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`,
  `YOUTUBE_WRITE_REFRESH_TOKEN`). Values are the current live values, mirrored
  in place — the plaintext Amplify env vars are still the authoritative
  source. Wiring SSM as the source requires build-time injection: see
  P0 #8 below.
- ✅ **Production Cognito self-signup DISABLED**
  (`AdminCreateUserConfig.AllowAdminCreateUserOnly=true` on
  `ca-central-1_JPXdswqHE`). Random registrations from the internet are
  blocked; the existing admin is unaffected. Codified in
  `scripts/apply-cognito-hardening.sh` (idempotent, safe to rerun).
- ✅ **TOTP MFA enabled as OPTIONAL** on the production Cognito pool. The
  admin can enrol a TOTP authenticator without lockout risk. Flipping to
  `MfaConfiguration=ON` is intentionally deferred until enrolment is
  confirmed — see P0 #9.
- ✅ **Middleware auth-guard regression test** added
  (`__tests__/middleware.test.ts`) — asserts `/admin/*` paths 307 to `/login`
  without a Cognito cookie, pass through with one, reject malformed cookie
  names, and the www→apex canonical redirect works.

---

## P0 — Required before any production launch

### 1. Configure RBAC 🔧
Current dev-stage posture: with no admin group and no `ADMIN_EMAILS`, **any
authenticated (verified-Cognito) user is treated as admin** and a warning is
logged. This is fine while the pool only contains trusted admins, but tighten
before real launch by doing one of:
- Create a Cognito group named `admin` (or `administrators`) and add admin users, **or**
- Set `ADMIN_EMAILS="you@tamilagaval.com,other@..."` (note: read at runtime, so
  it must be inlined via `next.config.ts` `env:` like the other server vars, not
  just set in the Amplify console).
Then verify a non-admin gets 403 from `/api/admin/*`.

### 2. Rotate & relocate secrets 🔧
> Tracked separately as an accepted dev-stage risk. **This is the pre-prod trigger to resolve it.**
>
> **2026-05-26 audit of the live site (tamilagaval.com):** the AWS key is **NOT
> in the browser bundle** (scanned homepage + /login chunks; tree-shaken out) —
> the residual exposure is the plaintext Amplify env vars (`amplify:GetApp`) +
> long-lived IAM key, not client JS. The media-bucket CORS was tightened from
> `AllowedOrigins:['*']` to an explicit allow-list (`src/config/cors.ts`).
> Still to do below: rotate the key and drop the `NEXT_PUBLIC_*AWS*` env vars.

The Amplify app stores production secrets as **plaintext env vars**, and the
AWS access key was additionally mirrored into `NEXT_PUBLIC_*` (shipped to the
browser bundle). Before launch:
- Rotate the AWS IAM access key; audit CloudTrail for prior usage.
- Rotate `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`; regenerate the Google TTS service-account key.
- **Remove all `NEXT_PUBLIC_*AWS*` vars** — route AWS calls through SSR/server actions only.
- Move secrets to AWS Secrets Manager and reference them; do not use plaintext Amplify env vars.

> ⚠️ **Key-rotation gotcha (build-time inlining).** Server secrets
> (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_TTS_CREDENTIALS_BASE64`, and
> `ADMIN_EMAILS`) are **compile-time-inlined** via `next.config.ts` `env:` —
> Amplify exposes app env vars at build time but not to the SSR runtime. The
> deployed app therefore runs whatever the value was **at the last build**.
> Editing the value in the Amplify console **does not take effect until you
> redeploy** (`aws amplify start-job --job-type RELEASE`). When rotating any of
> these, update the console value *and* trigger a release.
>
> _2026-06-04:_ inlining was expanded to `YOUTUBE_API_KEY` (/videos Data API
> fallback) and — notably — `APP_AWS_ACCESS_KEY_ID`/`APP_AWS_SECRET_ACCESS_KEY`
> so the SSR **runtime** can reach DynamoDB (Amplify gives the runtime no usable
> role token). The AWS app key is now baked into the server build artifact —
> accepted dev-stage tradeoff to unblock runtime DB writes (Save-brief); proper
> pre-prod fix is a scoped runtime IAM role / Secrets Manager.
>
> _Incident 2026-06-02:_ `/admin/compose` returned 401 `invalid x-api-key` in
> prod. Cause: a truncated 40-char `ANTHROPIC_API_KEY` was baked into the
> 2026-06-01 build; the console value had since been corrected to a valid
> 108-char key but no redeploy had run. Fixed by redeploying `master` (job #119).

### 3. Verify the live login + auth flow 🔧
Because the auth model changed, smoke-test on the deployed URL:
- Log in via Cognito → confirm `/admin` loads and `/api/admin/content` returns data.
- Confirm a request with no/expired/garbage `...idToken` cookie gets 401.
- Confirm the JWKS fetch succeeds from the SSR runtime (no outbound-network block).

### 8. Complete SSM SecureString migration for Amplify env vars 🔧
> Follow-up from the 2026-08-20 audit — the SSM params are already populated;
> the build wiring is what's missing.

13 sensitive values sit in SSM SecureString at
`/amplify/d3rkmepk4popv0/master/*` today, but Amplify Hosting does NOT
auto-inject them into the SSR runtime for this app. Verified 2026-08-20 by
removing the plaintext env vars and rebuilding: `yt-snapshot` started 401ing
within 3 min because `CRON_SECRET` was gone from `process.env` — reverted
build 589 immediately.

The correct migration is:

1. Grant the Amplify service role `ssm:GetParameter` on
   `arn:aws:ssm:ca-central-1:975050319109:parameter/amplify/${AWS_APP_ID}/${AWS_BRANCH}/*`
   (and `kms:Decrypt` on `alias/aws/ssm` if the default key is used).
2. In `amplify.yml`'s `preBuild`, iterate the sensitive-key list,
   `aws ssm get-parameter --with-decryption` each, and `export` them so
   `next.config.ts`'s `env:` block inlines them into the build artifact.
3. Trigger a build; verify the runtime picks the values up (yt-snapshot's
   5-min cron returns 200; a page that uses OpenAI/Anthropic renders
   correctly).
4. Only THEN remove the plaintext values from the Amplify env vars.

Skipping step 1 or step 3 recreates the 2026-08-20 breakage. Do not attempt
without first verifying the service role has the permission — the failure
mode is silent (values just aren't exported), the build succeeds, and the
runtime breaks minutes later.

### 9. Enable Cognito MFA=ON after admin enrolment 🔧
The production pool is currently `MfaConfiguration=OPTIONAL` (admin can enrol
without lockout). Once the admin has a TOTP device enrolled AND has
confirmed a login with the second factor, flip to REQUIRED so all future
users must enrol. Command lives in `scripts/apply-cognito-hardening.sh`
under `=== NEXT STEP ===`.

### 10. Scope down over-broad IAM identities 🔧
Two identities today have `AmazonDynamoDBFullAccess + AmazonS3FullAccess`
(full account-wide, not scoped):

- **`poo-vaasam-app-user`** — the runtime IAM user used by the SSR to reach
  DynamoDB + S3.
- **`AmplifyBackendRole-TamilWeb`** — the Amplify service role.

Scope both to only what Tamilagaval actually touches:
- DDB: `arn:aws:dynamodb:ca-central-1:975050319109:table/TamilWebContent`
  (+ any GSI ARNs)
- S3: `arn:aws:s3:::tamil-web-media/*`,
  `arn:aws:s3:::tamil-web-media-gated/*`,
  `arn:aws:s3:::tamilagaval-audio-masters/*`,
  `arn:aws:s3:::tamilagaval-cloudfront-logs/*` (plus bucket-level
  `s3:ListBucket` where the SDK requires it).

A compromise of either identity today is equivalent to compromise of every
S3 bucket + every DDB table in account `975050319109`.

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

- **DynamoDB PITR**: currently OFF on `TamilWebContent` in ca-central-1
  (production, 7532 items, ~1.5 MB → effectively free at ~$0.20/GB-mo).
  Enable with `scripts/enable-ddb-pitr.sh`.
- **Lambda concurrency limits**: the four `tamilagaval-*` worker Lambdas
  have no reserved concurrency, meaning a compromised admin or a client bug
  could rapidly queue many 3008-MB / 900-s invocations of `master-worker`.
  Apply reasonable ceilings with `scripts/apply-lambda-concurrency-limits.sh`
  (defaults: master-worker 3, compose-worker 3, measure-fn 3, yt-snapshot 2).
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

_Last updated: 2026-08-20 (DevOps audit: rotated leaked IAM key + deleted; Cognito self-signup off + MFA=OPTIONAL; mirrored 13 secrets to SSM SecureString; new P0 items #8/#9/#10; new scripts/apply-*.sh; middleware smoke test)._
