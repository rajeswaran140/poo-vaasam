# Tamilagaval — OAuth / Credential Security Runbook

Scope: the YouTube OAuth credentials that power tamilagaval.com automation (analytics digests, playlist/comment writes, publishing). Audited 2026-06-25.

## Inventory (Amplify app `d3rkmepk4popv0`, ca-central-1)

| Secret (env var) | Scope / power | Risk if leaked |
|---|---|---|
| `YOUTUBE_DATA_REFRESH_TOKEN` | `youtube.force-ssl` — **full channel write incl. DELETE videos/playlists** | 🔴 catalogue destruction |
| `YOUTUBE_ANALYTICS_REFRESH_TOKEN` | `yt-analytics.readonly` | 🟡 read analytics only |
| `YOUTUBE_OAUTH_CLIENT_SECRET` + `_CLIENT_ID` | mints tokens from a refresh token | 🔴 with a refresh token |
| `YOUTUBE_API_KEY` | API-restricted to YouTube Data API, read-only, no referrer/IP restriction | 🟡 quota exhaustion only |

GCP project: `tamilagaval-prod-2026`. API key name: `tamilagaval-youtube-read`. Channel: `UCZCuphXleq-mXVYgvqh-OlQ`.

## The security boundary is AWS IAM (not YouTube)
Anyone who can read the Amplify env can mint a `force-ssl` access token. As of 2026-06-25 that includes IAM users **`mobily-web`** and **`poo-vaasam`**, both with `AdministratorAccess` + static access keys. Re-scope + rotate those (see Hardening).

---

## 🚨 Incident Response — suspected OAuth credential compromise
Do these in order. Steps 1–2 stop the bleeding immediately.

1. **Revoke at Google (kills ALL tokens at once):** myaccount.google.com (the channel's Google account) → **Security → Third-party apps with account access** → find the `tamilagaval-prod-2026` app → **Remove access**. Every existing refresh + access token dies instantly.
2. **Rotate the OAuth client secret:** GCP Console → APIs & Services → Credentials → the OAuth 2.0 Client → **Reset secret** (or delete + recreate). Old client secret can no longer mint tokens.
3. **Re-mint refresh tokens** via the OAuth Playground (runbook in `project_tamilagaval_youtube` memory): one with `yt-analytics.readonly`, one with `youtube.force-ssl`. Sign in as the channel owner.
4. **Update storage:** put the new `CLIENT_ID/SECRET/REFRESH_TOKEN(s)` into AWS Secrets Manager (or Amplify env if not migrated yet) → **redeploy Amplify** (secrets inline at build).
5. **Rotate the API key** if it may have leaked: GCP → Credentials → regenerate `tamilagaval-youtube-read`; update env; redeploy.
6. **Verify automation:** mint a token in one shell call from the new creds; run the YouTube digest cron prompt; confirm `200`s.
7. **Forensics:** Google Account → Security → **Recent security activity** + **Your devices**; AWS **CloudTrail** (`simplatform-audit-trail`, multi-region) → search `secretsmanager:GetSecretValue` / `amplify:GetApp` around the suspected window.
8. **If channel content was altered/deleted:** YouTube Studio → content; deleted videos are generally unrecoverable → restore from your versioned off-AWS backups (see `reference_tamilagaval_backups`).

## 🔑 Routine key rotation (every ~90 days, no incident)
Same as steps 2–6 above, minus the Google revoke (step 1) unless you want a clean slate. Rotate API key + client secret + refresh tokens; redeploy; verify.

---

## Hardening checklist (priority order)
1. **Google account** (highest impact): passkey + authenticator (not SMS-only); review **Brand Account** owners/managers, remove unused; recovery email/phone current + MFA'd; review **third-party access** monthly.
2. **IAM least-privilege:** strip `AdministratorAccess` from `mobily-web` and `poo-vaasam`; scope to actual need; **rotate their access keys**; keep one MFA-protected human admin for break-glass, not app users.
3. **Move the 3 OAuth secrets to AWS Secrets Manager** (encryption, IAM, audit, versioning, rotation) — tighter than Amplify env.
4. **Already in place ✅:** CloudTrail multi-region (`simplatform-audit-trail`); AWS billing budgets/alarms. Add a **Google Cloud quota alert** for the YouTube Data API (GCP side, not covered by AWS billing).
5. **Backups:** keep versioned, off-AWS copies of lyrics, SUNO prompts, project files, OAuth config, deploy scripts (see `reference_tamilagaval_backups`).
