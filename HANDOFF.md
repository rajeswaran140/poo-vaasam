# Poo-Vaasam / Tamilagaval — Developer Handoff

**Last updated:** 2026-06-11 · **Site:** tamilagaval.com · **Amplify:** app `d3rkmepk4popv0`, branch `master`, region `ca-central-1` (auto-builds on push to master).

This is the canonical "where things stand" doc. Update it at the end of each work session. For deep background see the memory/runbook files linked at the bottom.

---

## ✅ Completed this session (2026-06-10 → 06-11)

### 1. SEO — theme collection pages (LIVE)
- New SSG pages **`/songs/[theme]`** (Tamil Mother Songs / Love / Homeland …) to capture broad category searches and internally link to song pages. **No lyrics** (deliberate — Raj doesn't want lyrics scraped by AI); original descriptive copy only.
- Files: `src/config/song-collections.ts` (per-theme copy + `eligibleCollectionThemes` — a theme needs ≥2 published songs), `src/app/songs/[theme]/page.tsx` (generateStaticParams/generateMetadata + CollectionPage & BreadcrumbList JSON-LD), `src/app/songs/page.tsx` ("Browse by theme" nav), `src/app/sitemap.ts` (collection routes).
- Tests: `__tests__/config/song-collections.test.ts`, `__tests__/app/songs-collection-metadata.test.ts`.
- Shipped: **Amplify job 218 SUCCEED**, master `5010c49`. Verified live: `/songs/{mother,love,homeland}`=200, `/songs/nonexistent`=404, all 3 in sitemap.

### 2. YouTube Analytics "Real views" — OAuth token RESTORED (LIVE)
- The `/admin/youtube` "Real views" column was dark (expired refresh token). **Now working** with real data.
- Done via a **new web OAuth client "Tamilagaval-web"** + a **`http://localhost` redirect** (the OAuth Playground kept silently using its own client — see gotchas). Exchanged an auth code server-side → wrote all three Amplify vars (`YOUTUBE_OAUTH_CLIENT_ID/_SECRET/_REFRESH_TOKEN`) → deployed.
- **Verified end-to-end:** token mints access tokens (scope `yt-analytics.readonly`) AND a live `youtubeanalytics.googleapis.com/v2/reports` query returned real data (**5,599 views / 28 days**). **Amplify job 220 SUCCEED.**
- Runbooks committed (master `5fac990`, **job 221 SUCCEED**): `YOUTUBE_TOKEN_FIX_RUNME.md` (one-shot commands) + `YOUTUBE_ANALYTICS_TOKEN_REFRESH.md` (background).

### 3. YouTube channel assets committed
- `youtube-subscribe-watermark.png` + `youtube-first-30-seconds-template.md` (retention playbook). Commit `80aafc8`.

---

## ⚠️ Highest-priority open item (time-sensitive)

**Publish the OAuth consent screen to PRODUCTION — or "Real views" breaks again ~2026-06-18.**
The Analytics refresh token was minted while the `tamilagaval-prod-2026` consent screen is in **Testing** mode, which expires refresh tokens after **7 days**. For continuous daily tracking with no weekly re-minting:
1. Console → `tamilagaval-prod-2026` → **APIs & Services → OAuth consent screen** → **PUBLISH APP** (→ "In production"). The unverified-app notice is harmless for this single-owner app.
2. Then re-mint the token **once** under production rules (long-lived): follow `YOUTUBE_TOKEN_FIX_RUNME.md` — click the localhost auth link, copy the `http://localhost/?...code=...` address-bar URL, run the one-shot command block.

If "Real views" goes dark around 2026-06-18, this is why; the fix is the two steps above.

---

## 📋 Other open items / backlog

| Item | State | Next action |
|---|---|---|
| **Daily Analytics snapshot** (hands-off monitoring) | Idea, not built | After token is permanent: build a scheduled job that pulls views/watch-time/retention daily and logs/emails a summary. Scoped, awaiting go-ahead. |
| **Google Search Console** verification meta | Blocked | Need Raj's GSC verification token (Search Console → add `tamilagaval.com` → HTML tag) → wire into root metadata → deploy. |
| **Per-song "about" descriptions** + romanized titles | Deferred SEO | Add descriptive copy + romanized title to individual song pages (lyrics-free). |
| **Composer #131 — Gemini benchmark** | Branch pushed, NOT merged | Branch `feat/composer-engine-adapter-gemini` (commit `9d2bacd`). Awaiting Raj's Gemini AI Studio key, then run `scripts/benchmark-composer.ts`, decide merge. Prod is untouched (Anthropic default). |
| **"For Performers" gated portal** | Concept | Raj's idea: give songs/music to singers who want to learn/perform. Gated + `noindex`. Not started. |
| **Cleanup** | Minor | Delete unused OAuth client `Tamilagaval-device` (`…-i7kb2st2…`) — device flow was a dead end. |

---

## 🧠 Operational knowledge / gotchas (save yourself the pain)

- **OAuth re-mint:** Google's OAuth **Playground keeps using its own default client `407408718192`** (the "Use your own OAuth credentials" checkbox doesn't stick), producing tokens our server can't refresh (`invalid_grant`). The reliable method is the **`http://localhost` redirect** on our own client — no Playground. **Device flow is a dead end** (Google rejects the read-only `yt-analytics.readonly` scope; do NOT escalate to full youtube write scope). Diagnose client config without a browser: POST the token endpoint with a bogus code → `invalid_grant`=client OK, `invalid_client`=bad creds; GET the consent URL → normal sign-in page = redirect URI is registered.
- **Do the code-exchange + Amplify write in ONE shell call.** The refresh token only exists in the curl response; shell vars don't persist across separate Bash calls, and the auth code is single-use — so if you print/mask it and re-run, it's lost and you need a fresh code.
- **gcloud cannot read consumer OAuth client / consent-screen config** — console-only (the IAP `oauth-brands` API is deprecated and unrelated). Verify functionally instead.
- **Amplify build model:** secrets are **inlined at build time** (not read at runtime). So any env-var change (incl. the OAuth vars) needs a **RELEASE build** to take effect; the SSR runtime has no DynamoDB creds, so list pages are build-time and new content needs a redeploy. (See memory `project_poo_vaasam_amplify_model`.)
- **Never write API keys / client secrets / tokens to disk** — keep them in shell variables only (the workspace classifier blocks disk writes, and it's a leak risk). Runbook files use paste-in placeholders for the secret.
- **Engineering contract:** DDD + TDD (test-first) + comprehensive tests (happy/error/edge/anon) + LLM never in render path + full suite/tsc/lint green before commit. Default models: `claude-opus-4-8`; composer uses `claude-sonnet-4-6`.

---

## 🔗 Pointers

- **Runbooks:** `YOUTUBE_TOKEN_FIX_RUNME.md`, `YOUTUBE_ANALYTICS_TOKEN_REFRESH.md`.
- **Code:** Analytics — `src/lib/youtube-analytics.ts`; admin dashboard — `src/app/(admin)/admin/youtube/page.tsx`; public feed — `src/lib/youtube-feed.ts`; SEO collections — `src/config/song-collections.ts` + `src/app/songs/[theme]/page.tsx`.
- **Note:** in-repo `*_AUDIT.md` files are STALE — don't trust them; this HANDOFF + the runbooks are current.
