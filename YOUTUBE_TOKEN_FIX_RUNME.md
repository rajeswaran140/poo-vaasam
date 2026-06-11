# YouTube Analytics Token — One-Shot Fix (RUN ME)

Restores the `/admin/youtube` **"Real views"** column. Self-contained: get one
code in the browser, then run **one** command block that exchanges it, updates
Amplify, and deploys. No OAuth Playground.

> ⚠️ **Do NOT commit this file with a secret pasted in.** The only fill-in is the
> client secret on the `CSEC=` line — paste it at run time, don't save it here.
> (Client IDs and auth URLs below are not secret and are safe to keep.)

---

## Part 1 — Get one fresh authorization code (browser)

1. One-time setup (already done once — verify it's still true):
   - Consent screen for `tamilagaval-prod-2026` is **In production** (APIs & Services → OAuth consent screen). *This stops the 7-day expiry.*
   - Client **"Tamilagaval-web"** has `http://localhost` under **Authorized redirect URIs**.

2. Click this link (carries the correct client `…-0kc8f8uq…`):

   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=75895058293-0kc8f8uqi8rhn2j70bvj4lmthk2ra42s.apps.googleusercontent.com&redirect_uri=http%3A%2F%2Flocalhost&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyt-analytics.readonly&access_type=offline&prompt=consent
   ```

3. Sign in as the **@tamilagaval owner** → **Allow**.

4. Browser shows **"localhost refused to connect" (ERR_CONNECTION_REFUSED)** —
   this is EXPECTED and means success.

5. Copy the **entire address-bar URL**. It looks like:
   ```
   http://localhost/?iss=https://accounts.google.com&code=4/0Adk...REAL_LONG_STRING...&scope=https://www.googleapis.com/auth/yt-analytics.readonly
   ```

> The code is single-use and expires in ~10 min — run Part 2 promptly. If it
> fails, just re-click the link for a brand-new code.

---

## Part 2 — Exchange + update Amplify + deploy (one command block)

Paste the client secret on the `CSEC=` line and your full URL on the `URL=` line,
then run the whole block (prefix the first line with `!` to run it in the Claude
session, or run in any shell with AWS creds):

```bash
CID='75895058293-0kc8f8uqi8rhn2j70bvj4lmthk2ra42s.apps.googleusercontent.com'
CSEC='PASTE_TAMILAGAVAL_WEB_CLIENT_SECRET_HERE'      # GOCSPX-… (from chat, do not save in file)
URL='PASTE_FULL_http://localhost/?...code=..._URL_HERE'

# 1) pull the authorization code out of the pasted URL
CODE=$(URL="$URL" python3 -c "import os,urllib.parse as u;print(u.parse_qs(u.urlparse(os.environ['URL']).query)['code'][0])")

# 2) exchange the code for a refresh token (bound to OUR client)
RT=$(curl -s -X POST https://oauth2.googleapis.com/token \
  --data-urlencode "code=$CODE" \
  --data-urlencode "client_id=$CID" \
  --data-urlencode "client_secret=$CSEC" \
  --data-urlencode "redirect_uri=http://localhost" \
  -d "grant_type=authorization_code" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('refresh_token',''))")
if [ -z "$RT" ]; then echo "EXCHANGE FAILED — get a fresh code (Part 1) and retry"; else echo "OK: refresh token received (${#RT} chars, starts ${RT:0:5}…)"; fi

# 3) merge the 3 OAuth vars into Amplify env (every other var preserved)
ENVJSON=$(aws amplify get-app --app-id d3rkmepk4popv0 --region ca-central-1 --query 'app.environmentVariables' --output json)
MERGED=$(ENVJSON="$ENVJSON" CID="$CID" CSEC="$CSEC" RT="$RT" python3 -c '
import json,os
d=json.loads(os.environ["ENVJSON"])
d["YOUTUBE_OAUTH_CLIENT_ID"]=os.environ["CID"]
d["YOUTUBE_OAUTH_CLIENT_SECRET"]=os.environ["CSEC"]
d["YOUTUBE_REFRESH_TOKEN"]=os.environ["RT"]
print(json.dumps(d))')
aws amplify update-app --app-id d3rkmepk4popv0 --region ca-central-1 --environment-variables "$MERGED" >/dev/null && echo "Amplify env updated (CLIENT_ID + CLIENT_SECRET + REFRESH_TOKEN)"

# 4) trigger a production build so the new env is inlined
aws amplify start-job --app-id d3rkmepk4popv0 --branch-name master --region ca-central-1 --job-type RELEASE \
  --query 'jobSummary.{jobId:jobId,status:status}' --output table
```

---

## Part 3 — Verify

```bash
# A) confirm the new token refreshes cleanly (no invalid_grant)
curl -s -X POST https://oauth2.googleapis.com/token \
  --data-urlencode "client_id=$CID" \
  --data-urlencode "client_secret=$CSEC" \
  --data-urlencode "refresh_token=$RT" \
  -d "grant_type=refresh_token" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('TOKEN OK' if 'access_token' in d else 'STILL BROKEN: '+str(d))"

# B) watch the deploy until SUCCEED
JID=$(aws amplify list-jobs --app-id d3rkmepk4popv0 --branch-name master --region ca-central-1 --query 'jobSummaries[0].jobId' --output text)
aws amplify get-job --app-id d3rkmepk4popv0 --branch-name master --job-id "$JID" --region ca-central-1 --query 'job.summary.status' --output text
```

After the deploy reaches **SUCCEED**, open `/admin/youtube` — the **"Real views"**
column populates from YouTube Analytics.

---

## Notes

- Code paths: `src/lib/youtube-analytics.ts` (mints access tokens from the refresh
  token); admin column in `src/app/(admin)/admin/youtube/page.tsx`.
- The **production consent screen** (Part 1, step 1) is what makes the refresh
  token long-lived. If it's still in *Testing*, the token dies again in 7 days.
- Companion reference: `YOUTUBE_ANALYTICS_TOKEN_REFRESH.md` (the "why / background").
- Unused leftover: the `Tamilagaval-device` ("TVs/Limited Input") client can be
  deleted — device flow rejects the read-only analytics scope.
- **Never persist the client secret / tokens to a file** — keep them in shell
  variables only.
