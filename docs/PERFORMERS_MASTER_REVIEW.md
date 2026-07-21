# `feat/performers-auth → master` — Go/No-Go Crux Review

**Scope:** merging the Performers feature (Cognito consumer-auth tier + gated
lyrics/karaoke) to production. This is categorically larger than the karaoke
serving-path work: it introduces a **public consumer-auth surface** and, for the
first time, **personal data**, to production. Each crux below is a go/no-go with
verified evidence — not a checklist.

**Blast radius:** 50 files, +3330/−17 vs `master` (verified `git diff --stat`).

## Decision summary

| # | Crux | Decision | Blocker? |
|---|------|----------|----------|
| 1 | Consumer-auth attack surface | 🟡 CONDITIONAL GO | Enable Cognito Advanced Security (has a per-MAU cost) |
| 2 | Rate-limiting / abuse | 🔴 NO-GO | Wire the existing limiter to unauth endpoints |
| 3 | PIPEDA / personal data | 🔴 NO-GO | 3a consent (code) **and** 3b deletion runbook (ops) — both |
| 4 | Blast radius of the merge | 🟢 GO | — (final read of ~6 shared files) |
| 5 | Entitlement vs authentication | 🟢 GO | Confirmed (owner, 2026-07-21): free for any verified account |

**Net: two hard blockers (rate-limiting, PIPEDA consent+deletion), one condition
(Advanced Security), and one decision awaiting the owner's confirmation
(entitlement). The surface is otherwise well-managed** — much of the risk a
generic "adding consumer auth" implies is absorbed by Cognito.

---

## Crux 1 — Consumer-auth attack surface 🟡 CONDITIONAL GO

**Evidence.**
- Auth is **Cognito-managed** (Amplify `Authenticator`): signup, signin,
  password reset, email verification, token refresh — none hand-rolled.
- Token verification **reuses the existing admin path** (`aws-jwt-verify`
  `CognitoJwtVerifier` in `auth-helper.ts`) — already in production for admin.
- Middleware gates **only `/admin`** (`middleware.ts` line 34); `/performers`
  adds an inline client gate + server `requirePerformer` on its API routes.
  Adding the tier does **not** change any existing route's exposure — additive.
- Cognito posture (verified via `describe-user-pool`): password policy
  8+/upper/lower/number/symbol; **SRP** auth (no plaintext password flow);
  `PreventUserExistenceErrors` **ENABLED** (account enumeration mitigated on
  signin/reset); email auto-verify; deletion protection ACTIVE.

**Gap.** `AdvancedSecurityMode` is **OFF** — no compromised-credential detection,
adaptive auth, or bot signals on an **open self-signup** pool.

**Clear it:** enable Cognito Advanced Security (start `AUDIT`, observe, then
`ENFORCED`). Everything else on this crux is already sound.

**Cost note:** Advanced Security is priced **per monthly active user** — negligible
at the current subscriber count, but a known line item that scales with adoption.
Not a reason to skip it; a reason to size it consciously. `AUDIT` first also lets
you observe volume before committing to `ENFORCED`.

## Crux 2 — Rate-limiting / abuse 🔴 NO-GO

**Evidence.**
- Brute-force / credential-stuffing target the **Cognito** endpoints, not our
  routes → Cognito's managed throttling (and Advanced Security once on) owns it.
- BUT `src/lib/rate-limit.ts` **exists and is NOT wired** to our own
  unauthenticated write endpoints — verified: no usage in `/api/subscribe`,
  `/api/lyrics/unlock`, or the performer routes. These are open to flooding /
  email-verification spam.
- Self-signup is **open** (intended, self-serve) → fake-account / verification
  abuse is possible.

**Clear it (blocker):**
1. Wire `rate-limit.ts` onto `/api/subscribe` and `/api/lyrics/unlock` (per-IP;
   note the XFF-bypass fix already exists on a branch — use it).
2. Decide the limiter home for the token-gated performer routes (lower priority
   — they need a valid token) — likely fine to defer, but state it.
3. Consider Cognito bot protection (Advanced Security / CAPTCHA) for signup.

## Crux 3 — PIPEDA / personal data 🔴 NO-GO

**Evidence.**
- Personal data (emails, names, Cognito auth records, `SUBSCRIBER#` items) lives
  in **`ca-central-1`** (pool `ca-central-1_…`) — residency is correct (this is
  the case where Canada *does* matter, unlike the instrumental audio).
- Emails/names are **already** collected in production (email-lyrics gate +
  `/api/subscribe`), so this isn't wholly new — but Cognito accounts formalize it.

**Gaps — this crux has two independent halves and stays 🔴 until BOTH clear:**

- **3a — Consent (CODE).** The signup terms-acceptance is a **client-only gate**
  (per project history — never server-persisted). We can't demonstrate a user
  agreed. Persist consent server-side at signup as a **durable, auditable record**
  (timestamp + terms version), in `ca-central-1`, with a stated retention posture.
  Clears in its own PR — reviewed *as a privacy artifact*, not buried in plumbing.
- **3b — Deletion / access process (OPS).** PIPEDA gives right of access + erasure.
  A data-subject request needs an actual runbook: account deletion must remove the
  Cognito user **and** the `SUBSCRIBER#` record **and** any performer data. This is
  a documented process, not code — low-volume, but required to exist.
- Privacy notice / retention statement covering what's stored and for how long.

**3a (code PR) clearing does NOT clear crux #3** — it's half. Crux #3 is GO only
when 3a *and* 3b both exist.

## Crux 4 — Blast radius of the merge 🟢 GO

**Evidence.** The 50-file diff is: the performer/auth files + the (already
reviewed) karaoke feature + a small set of shared touch-points —
`Content.ts` (adds optional `PerformerAssets`), `types/content.ts`,
`s3-client.ts`, `api/admin/upload` (adds an `instrumental` kind → private
prefix), `(admin)/layout.tsx` (nav link), `robots.ts` (disallow `/performers`).
All additive; nothing unrelated rides along.

**Clear it:** a final read of those ~6 shared files' diffs before merge — cheap,
and it's the only place a regression could hide. No blocker.

## Crux 5 — Entitlement vs authentication 🟢 GO

**Evidence.** `requirePerformer` = authenticated **+ `emailVerified`**, nothing
more — **no paid entitlement**. This is the Phase-1 design decision: the tier is
**free** for any verified account. So "authenticated-but-unentitled reaching
`/track`" doesn't exist — every verified account *is* entitled, by intent.
`requirePerformer` is the single chokepoint if a paid tier is ever introduced.

This is a **product decision wearing a security-review checkmark**: an
authenticated-but-unentitled user *can* reach `/track`, and that's intended *iff*
the tier is free. Verified: no paid/plan logic exists in the performer routes, so
the code matches "free tier." But the 🟢 is correct only if the owner confirms
"free for any verified account" is the intended boundary, with monetization (if
any) elsewhere.

**CONFIRMED 2026-07-21 (owner): free for any verified account is intended** —
monetization (if any) lives elsewhere. Crux #5 is 🟢 GO on the evidence *and* the
decision. `requirePerformer` is the named single chokepoint if a paid gate is ever
introduced for instrumentals; unenforced today, by design.

---

## Recommended path to GO

1. **Blockers first:** (a) wire `rate-limit.ts` to the two unauth endpoints;
   (b) server-persist signup consent; (c) document the deletion/access runbook.
2. **Condition:** flip Cognito Advanced Security to `AUDIT`, watch, then `ENFORCED`.
3. **Pre-merge:** read the ~6 shared-file diffs; confirm the free-tier boundary.
4. Then merge → deploy → the karaoke go-live sequence (publish → IAM → authed
   `/track` playback via `verify-track-playback.ts` → 403 probe) runs against a
   real endpoint, as staged in `docs/KARAOKE_STEM_PIPELINE.md`.

Items 1a and 1b are code changes (their own PRs); 1c/2/3 are ops/config. None are
large — the review is narrow because Cognito absorbs most of the auth surface.
