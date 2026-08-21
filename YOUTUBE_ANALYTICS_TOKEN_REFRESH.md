# YouTube Analytics — Refresh-Token Re-Mint Runbook

How to restore the **/admin/youtube "Real views"** column when its OAuth token
dies. The admin dashboard reads YouTube Analytics v2 (`reports`) using an OAuth
refresh token stored in Amplify. When that token expires, the column shows `—`.

- **GCP project:** `tamilagaval-prod-2026`
- **OAuth client (our app, NEW web client "Tamilagaval-web" created 2026-06-11):** `75895058293-0kc8f8uqi8rhn2j70bvj4lmthk2ra42s.apps.googleusercontent.com`
  - Client **secret is NOT stored in this file** (credential) — it lives in the Amplify env var `YOUTUBE_OAUTH_CLIENT_SECRET`.
  - _(Previous client `…-bd9fhrqh…` is retired; tokens minted under it no longer apply.)_
- **Scope needed:** `https://www.googleapis.com/auth/yt-analytics.readonly`
- **Amplify app / region:** `d3rkmepk4popv0` / `ca-central-1`
- **Env vars to update:** normally just `YOUTUBE_ANALYTICS_REFRESH_TOKEN`. **When switching
  to a new OAuth client (as on 2026-06-11), update all three:**
  `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_ANALYTICS_REFRESH_TOKEN`.
  (Env changes apply on the next RELEASE build — secrets are inlined at build time,
  so the live site is unaffected until then.)

---

## Why it keeps breaking (read this first)

Two recurring traps — both must be avoided or the token is useless:

1. **Wrong client.** The OAuth Playground's "Use your own OAuth credentials"
   checkbox often does NOT stick, so it silently uses the Playground's *default*
   client `407408718192`. A refresh token minted under `407408718192` cannot be
   refreshed by our server (which uses client `75895058293` + secret) → it fails
   with `invalid_grant`. **Tell-tale:** the token-exchange request shows
   `client_id=407408718192...`. If you see that, the token is garbage — discard it.

2. **7-day expiry.** While the consent screen is in **Testing** mode, Google
   kills refresh tokens after 7 days (`refresh_token_expires_in: 604799`).
   Publishing the consent screen to **production** removes that expiry.

**The fix below sidesteps trap #1 entirely** by baking our client into the
authorization URL and doing the token exchange server-side — no Playground
buttons, no checkbox to get wrong.

---

## Step A — Publish the consent screen to production (one-time, stops 7-day expiry)

1. [console.cloud.google.com](https://console.cloud.google.com) → select project **`tamilagaval-prod-2026`** (top bar).
2. **APIs & Services → OAuth consent screen** (newer UI: **Audience**).
3. If **Publishing status: Testing** → click **PUBLISH APP** → confirm.
   - Ignore any "needs verification" warning — for a single owner channel an
     unverified *production* app works fine and tokens stop expiring weekly.
4. Confirm it now reads **Publishing status: In production**.

> If you skip Step A, the new token still works — but dies again in 7 days.

---

## Step B — Register the Playground redirect URI (one-time)

1. **APIs & Services → Credentials** (still in `tamilagaval-prod-2026`).
2. Under **OAuth 2.0 Client IDs**, click the new client **"Tamilagaval-web"** (`75895058293-0kc8f8uq…`).
3. **Authorized redirect URIs** → **+ ADD URI** → paste exactly (no trailing slash, all lowercase):
   ```
   https://developers.google.com/oauthplayground
   ```
4. **SAVE.** (Propagation is usually instant; occasionally up to ~2 min.)

> This is additive — leave any existing URIs alone. It goes under *Authorized
> redirect URIs*, NOT *Authorized JavaScript origins*.

---

## Step C — Get a fresh authorization code (the actual re-mint)

1. Click **this exact authorization link** (carries the new client `…-0kc8f8uq…`):

   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=75895058293-0kc8f8uqi8rhn2j70bvj4lmthk2ra42s.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fdevelopers.google.com%2Foauthplayground&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyt-analytics.readonly&access_type=offline&prompt=consent
   ```

2. Sign in as the **@tamilagaval channel-owner** Google account → **Allow**.

3. The browser lands on the OAuth Playground page. **Ignore the whole page.**
   Look only at the **browser address bar**:
   ```
   https://developers.google.com/oauthplayground/?code=4%2F0Adk...XXXX&scope=...
   ```

4. Copy the **`code` value** — everything between `code=` and the next `&`
   (it starts with `4%2F0` or `4/0`). **That string is what to hand off.**

   ❌ Do **NOT** click "Authorize APIs" or "Exchange authorization code for
      tokens" in the Playground — those use the wrong client `407408718192`.
   ✅ Just copy the `code` from the address bar.

> The code is single-use and valid ~10 minutes — use it promptly.

---

## Step D — Exchange + deploy (Claude does this, server-side)

> **Client-switch note (2026-06-11):** the NEW client `…-0kc8f8uq…` + its secret
> are NOT yet in Amplify, so the exchange uses the new values directly (kept
> in-memory from the chat, never written to disk). On a routine re-mint with an
> already-configured client, pull `CID`/`CSEC` from Amplify instead.

**1. Exchange the code** (uses the NEW client "Tamilagaval-web"):

```bash
CID='75895058293-0kc8f8uqi8rhn2j70bvj4lmthk2ra42s.apps.googleusercontent.com'
CSEC='<new client secret — from chat / console, NOT this file>'
CODE='<paste code from Step C, URL-decoded>'

curl -s -X POST https://oauth2.googleapis.com/token \
  -d "code=${CODE}" \
  -d "client_id=${CID}" \
  -d "client_secret=${CSEC}" \
  -d "redirect_uri=https://developers.google.com/oauthplayground" \
  -d "grant_type=authorization_code"
# -> expect JSON with "refresh_token": "1//..." (this is bound to the new client)
```

**2. Update Amplify env + redeploy.** On the client switch, set **all three**
vars (CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN); build the merged JSON
programmatically so no long secret is hand-pasted, keeping every other env var
intact:

```bash
ENVJSON=$(aws amplify get-app --app-id d3rkmepk4popv0 --region ca-central-1 --query 'app.environmentVariables' --output json)
MERGED=$(ENVJSON="$ENVJSON" CID="$CID" CSEC="$CSEC" RTOK="$RTOK" python3 -c '
import json,os
d=json.loads(os.environ["ENVJSON"])
d["YOUTUBE_OAUTH_CLIENT_ID"]=os.environ["CID"]
d["YOUTUBE_OAUTH_CLIENT_SECRET"]=os.environ["CSEC"]
d["YOUTUBE_ANALYTICS_REFRESH_TOKEN"]=os.environ["RTOK"]
print(json.dumps(d))')
aws amplify update-app --app-id d3rkmepk4popv0 --region ca-central-1 --environment-variables "$MERGED"
aws amplify start-job --app-id d3rkmepk4popv0 --branch-name master --region ca-central-1 --job-type RELEASE
```

**3. Verify.** After the deploy succeeds, the `/admin/youtube` "Real views"
column populates. Sanity-check the new token refreshes cleanly:

```bash
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CID}" -d "client_secret=${CSEC}" \
  -d "refresh_token=${RTOK}" -d "grant_type=refresh_token"
# -> must return an access_token (NOT invalid_grant)
```

---

## Permanent reduction of toil

- Doing **Step A** (production consent screen) is what stops the weekly expiry —
  do it once and re-mints become rare (only on revoke / scope change).
- Code paths: `src/lib/youtube-analytics.ts` (mints access tokens from the
  refresh token), admin column in `src/app/(admin)/admin/youtube/page.tsx`.
- **Never write the API key / client secret / tokens to disk** (the workspace
  classifier blocks it, and it's a credential-leak risk) — keep them in shell
  variables / in-memory only.
