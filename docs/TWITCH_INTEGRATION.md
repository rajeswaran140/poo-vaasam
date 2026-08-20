# Twitch Integration — Phase 1

Connect a Twitch channel to TamilAgaval, keep the connection healthy, detect
live/offline, and ingest verified EventSub events.

Scope and design rationale: `.claude/plans` is not committed — the durable
record is this document plus the module headers in `src/lib/twitch/*`.

---

## 1. Twitch Developer Console setup

1. Sign in at <https://dev.twitch.tv/console/apps> and **Register Your Application**.
2. **Name** — anything unique to the environment, e.g. `TamilAgaval (prod)`.
3. **OAuth Redirect URLs** — add one per environment (see §2). Exact match required.
4. **Category** — *Website Integration*.
5. **Client Type** — *Confidential*. The secret is used server-side only.
6. Create, then copy the **Client ID** and generate a **Client Secret**.
   The secret is shown once; regenerating it invalidates the old one.

> Register a **separate application per environment**. Twitch matches the
> redirect URI exactly, and sharing one app across dev and prod means a
> production connection can be completed from a developer's laptop.

---

## 2. Callback URLs

| | OAuth redirect URI | EventSub callback |
|---|---|---|
| **Production** | `https://tamilagaval.com/api/twitch/callback` | `https://tamilagaval.com/api/twitch/eventsub` |
| **Staging** | `https://<branch>.<appid>.amplifyapp.com/api/twitch/callback` | `https://<branch>.<appid>.amplifyapp.com/api/twitch/eventsub` |
| **Local** | `http://localhost:3002/api/twitch/callback` | a tunnel — see §6 |

🔴 **Use the apex host, never `www`.** `src/middleware.ts` 301-redirects
`www.tamilagaval.com` → `tamilagaval.com`. Twitch would follow the redirect for
OAuth but the EventSub callback verification would fail, and the subscription
would never leave `webhook_callback_verification_pending`.

🔴 **EventSub requires HTTPS on port 443.** Twitch will not call an HTTP or
non-443 endpoint, which is why local development needs a tunnel.

---

## 3. Environment variables

| Variable | Purpose |
|---|---|
| `TWITCH_CLIENT_ID` | Application client ID. |
| `TWITCH_CLIENT_SECRET` | Client secret. Also signs the OAuth `state` token. |
| `TWITCH_EVENTSUB_SECRET` | Shared secret for the EventSub HMAC. **10–100 ASCII characters** (Twitch's rule). |
| `TWITCH_REDIRECT_URI` | Must exactly match a registered redirect URL. |
| `TWITCH_EVENTSUB_CALLBACK_URL` | The public `/api/twitch/eventsub` URL. |

### 🔴 Setting them requires TWO steps and a redeploy

Amplify's SSR runtime does **not** expose app environment variables. A value set
only in the Amplify console is `undefined` at runtime and the panel will report
*Not configured*.

1. Add the variable in **Amplify console → Hosting → Environment variables**.
2. Confirm it is listed in the `env:` block of `next.config.ts` (all five
   already are).
3. **Redeploy.** The values are inlined at build time, so rotating any secret
   requires a new build — there is no runtime refresh.

This matches how every other server secret in this app is handled
(`YOUTUBE_OAUTH_CLIENT_SECRET`, `GA4_SERVICE_ACCOUNT_KEY`, …). `HARDENING.md` §2
tracks moving these to Secrets Manager; that is a codebase-wide change, not a
Twitch-specific one.

> Changing `TWITCH_EVENTSUB_SECRET` invalidates existing EventSub subscriptions —
> Twitch signs with the secret registered *at subscription time*. After rotating
> it, press **Disconnect** then **Connect Twitch** so the subscriptions are
> recreated with the new secret.

---

## 4. OAuth scopes — and why there are none

**Phase 1 requests no scopes at all.** Verified against the current Twitch
documentation:

- `Get Users` with a user access token returns the authenticated user's id,
  login, display name and profile image — **no scope required**;
- `Get Streams` is public data — **no scope required**;
- `stream.online` and `stream.offline` EventSub subscriptions — **no scope
  required** on their condition.

OAuth exists here purely to **prove channel ownership**. Requesting more would
be permission we cannot justify to the person authorising.

Future event types add their scope in `src/lib/twitch/config.ts`, where each is
listed with the reason:

| Event | Scope |
|---|---|
| `channel.follow` | `moderator:read:followers` |
| `channel.subscribe`, `channel.subscription.gift` | `channel:read:subscriptions` |
| `channel.cheer` | `bits:read` |
| `channel.channel_points_custom_reward_redemption.add` | `channel:read:redemptions` |
| `channel.chat.message` | `user:read:chat` |

The scopes Twitch actually granted are stored on the connection, so what a token
can do is always readable.

---

## 5. Architecture

```
Twitch EventSub
      ↓  POST /api/twitch/eventsub          (public, rate-limited)
verify HMAC signature  ─ reject 403
      ↓
timestamp freshness    ─ reject 403         (replay protection)
      ↓
parse envelope         ─ reject 400         (never 5xx: Twitch retries 5xx)
      ↓
normalize()                                 lib/twitch/normalize.ts
      ↓
conditional put by message id  ─ duplicate → 200, no reprocessing
      ↓
respond 2XX
      ↓
processTwitchEvent()                        application/use-cases
      ↓
stream sessions → (Phase 2) song-play spans → analytics
```

**No queue.** Ingest is a single conditional DynamoDB write, well inside the few
seconds Twitch allows. SQS/EventBridge would add cost and operational surface
for no reliability gain at this volume.

### Storage (single table, existing conventions)

| Item | PK | SK |
|---|---|---|
| Connection (public) | `TWITCHCONN#<tenantId>` | `METADATA` |
| Connection secrets | `TWITCHCONN#<tenantId>` | `SECRET` |
| EventSub subscription | `TWITCHCONN#<tenantId>` | `SUB#<subId>` |
| Stream session | `TWITCHSTREAM#<tenantId>` | `SESSION#<startedAt>#<streamId>` |
| Raw event | `TWITCHEVENT#<messageId>` | `METADATA` |

Tokens live in a **separate item** so that reading a connection to display it
never loads them. Raw events are keyed by Twitch's message id, which is what
makes ingest idempotent, and carry a 90-day TTL.

`tenantId` is on every row (currently always `tamilagaval`). That is the seam
for a future multi-tenant service — not a multi-tenancy implementation.

### Song catalogue

There is **no second song store**. Phase 2 song-play spans reference
`Content.id` — the existing catalogue identifier behind `PublicSong`.

---

## 6. Local development

Twitch requires a public HTTPS:443 callback, so EventSub cannot reach
`localhost` directly.

```bash
npm run dev                       # http://localhost:3002

# Option A — Twitch CLI (no tunnel needed for event simulation)
twitch event trigger stream.online \
  -F http://localhost:3002/api/twitch/eventsub \
  -s "$TWITCH_EVENTSUB_SECRET"

# Option B — a tunnel, for the real subscription lifecycle
#   expose 3002 over HTTPS, then register a dev Twitch app whose
#   redirect + EventSub callback point at the tunnel host.
```

Put the five variables in `.env.local`. The Twitch CLI signs requests exactly as
Twitch does, so it exercises signature verification for real.

---

## 7. Tests

```bash
npx jest __tests__/lib/twitch-signature.test.ts \
         __tests__/lib/twitch-oauth-state.test.ts \
         __tests__/lib/twitch-normalize.test.ts \
         __tests__/lib/twitch-process-event.test.ts \
         __tests__/lib/twitch-connect.test.ts \
         __tests__/api/twitch-eventsub.test.ts \
         __tests__/api/twitch-oauth-routes.test.ts
```

All Twitch HTTP calls are mocked — **the suite never contacts Twitch**. Covered:
signature verification (valid / tampered / wrong secret / wrong message id /
stale), OAuth state (valid / expired / forged / malformed), the verification
challenge's exact response contract, duplicate suppression, `stream.online`
opening a session, `stream.offline` closing it, malformed payloads, revocation,
token refresh and re-auth, and disconnect with Twitch unreachable.

---

## 8. Deployment

Standard flow: branch → PR → `master` → Amplify builds automatically.

The Amplify `preBuild` runs the **whole Jest suite as a deploy gate** — a
failing Twitch test blocks the deploy.

After the first deploy to a new environment:

1. Set the five variables (§3) and redeploy so they inline.
2. Open `/admin/twitch` → **Connect Twitch** → authorize.
3. Confirm the panel shows the channel and **EventSub: Active**.

---

## 9. EventSub subscription lifecycle

```
created  →  webhook_callback_verification_pending
              ↓ Twitch POSTs a challenge; we echo it as text/plain
            enabled                       ← events now deliver
              ↓
            revoked / notification_failures_exceeded / authorization_revoked
```

- **Verification** happens immediately on creation. If the callback URL is
  wrong, unreachable, or answers the challenge incorrectly, the subscription
  goes to `webhook_callback_verification_failed` and must be recreated.
- **Revocation** arrives as a `revocation` message. We record the status against
  the subscription, and for `authorization_revoked` / `user_removed` we mark the
  connection `reauth_required` so the panel asks for re-authorisation rather
  than silently going quiet.
- **Reconnect** re-creates any subscription that is not live, without sending
  the admin through Twitch's consent screen.
- **Disconnect** deletes the subscriptions at Twitch, revokes the access token,
  and removes the stored tokens. Sessions and event history are **kept** — they
  are analytics, not credentials.

Creating a webhook subscription requires an **app access token** (client
credentials); a user token is rejected. The app token has no refresh token and
is minted on demand and cached in-process.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Panel says **Not configured** | Variables missing, or set in Amplify but not inlined | §3 — check `next.config.ts` and **redeploy** |
| Subscription stuck **pending** | Callback unreachable, or challenge answered incorrectly | Confirm the URL is HTTPS:443, apex host, publicly reachable |
| Everything works, then events stop | `notification_failures_exceeded` — we timed out too often | Press **Reconnect**; if it recurs, move the webhook to a dedicated Lambda (see the note below) |
| 403 in the logs on every event | `TWITCH_EVENTSUB_SECRET` differs from the one registered with the subscription | Disconnect → Connect to recreate with the current secret |
| Connection shows **reauth_required** | User revoked access, or changed their password | **Reauthorize** — a refresh cannot recover this |
| Connection shows **degraded** | Twitch API failing, or a subscription could not be created | Usually transient; **Reconnect**. `lastError` says which |
| `invalid_state` after authorizing | The connect link was older than 10 minutes | Start from **Connect Twitch** again |
| Live status wrong right after going live | EventSub delivery lag | The panel also polls `Get Streams`, so a refresh corrects it |

**Known risk.** The webhook runs on Amplify SSR, whose cold start could exceed
Twitch's few-second budget under load; repeated timeouts revoke the
subscription. Signature verification, normalisation and processing are all pure
modules under `src/lib/twitch/` and `src/application/use-cases/`, so moving the
handler to a Lambda Function URL would be a thin transport change rather than a
rewrite. The panel surfaces subscription status so this is visible rather than
silent.

---

## 11. Not in Phase 1

Now Playing, song requests, voting, dedications, chat ingest, the Twitch
Extension, billing, additional event types, and any multi-tenancy refactor.
