# Expiring delivery links — Design

- **Date:** 2026-09-14
- **Status:** Approved design. Implementation plan not yet written.
- **Scope:** Time-limited, use-limited download links on `tamilagaval.com` for paid deliverables.

---

## 1. Purpose

Sell a file and deliver it without exposing it publicly.

The first karaoke commission (two instrumental versions, CAD $40 each) was delivered over the public CDN because nothing better existed. That URL has no signature and no expiry — anyone holding it can download the track indefinitely. This replaces that with a link on the operator's own domain that stops working.

**Not in scope:** taking payment. There is no payment infrastructure in this codebase and none is added here. The operator confirms payment out of band and creates the link afterwards.

## 2. Decisions locked before writing this spec

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D1 | Delivery mechanism | **Token in DynamoDB → 302 to a short-lived presigned S3 GET** | Streaming through the API route; CloudFront signed URLs |
| D2 | Use limit | **3 downloads** | Strictly one; unlimited |
| D3 | Expiry | **7 days** | 48 hours; per-link choice |
| D4 | Payment gating | **Manual — the operator creates the link after payment lands** | Stripe or other webhook |

### Why not stream through the route

Amplify's managed compute has a **~30 s execution ceiling**. A 12 MB file to a phone on a poor connection exceeds that, and the buyer gets a truncated download with no error. The same wall already pushed compose, critique, suno-setup and mastering onto worker Lambdas; there is no reason to expect a different outcome here.

### Why not CloudFront signed URLs

They need a trusted key group and a private key to store and rotate — new AWS resources and a new secret — for no capability this design lacks.

### Why three downloads rather than one

A single-use token cannot distinguish "downloaded successfully" from "the request was made". S3 reports that a URL was fetched, not that the browser finished writing the file. A cancelled or dropped download would burn the only use, and the operator would hear about it by email. Three uses absorbs a retry, a second device, and a mis-click, while still being a hard stop.

## 3. The detail that shapes the design: link scanners

**Email security filters prefetch URLs.** Outlook, Gmail and most corporate gateways fetch links in a message to check them before the recipient ever clicks. A bare `/d/<token>` that redirected straight to the file would consume one of three downloads on delivery, and possibly all three if the mail passes through several filters.

So the token URL serves a **page**, not a redirect. The page shows the filename, size and expiry with a Download button. Only the button hits the counting endpoint.

A scanner fetching the page costs nothing. This is the single most important behaviour in the design and the easiest to lose in a later refactor.

## 4. Data model

One item in the existing `TamilWebContent` table. No new table, no new GSI.

```
PK = DELIVERY#<token>
SK = METADATA

     entityType    'DELIVERY'
     token         32 random bytes, base64url — 43 chars
     s3Key         the object to serve; NEVER sent to the client
     filename      what the buyer's browser saves it as
     label         operator's own reference, e.g. "Anton — Sevvanthi karaoke"
     contentLength bytes, shown on the page so the buyer knows what to expect
     createdAt, expiresAt
     maxDownloads  3
     downloadCount 0
     downloads[]   { at, ip } per hit — evidence if delivery is ever disputed
     revokedAt     null until the operator kills it early

     GSI1PK = 'DELIVERY'                    sparse — the admin list
     GSI1SK = '<createdAt>#<token>'
     ttl                                    expiresAt + 30 days
```

**Access patterns**

| Pattern | Mechanism | Index |
|---|---|---|
| Resolve a token | `GetItem PK=DELIVERY#<token>` | none |
| List deliveries for the admin | `Query GSI1PK='DELIVERY'` | GSI1 (sparse) |

`GSI1PK='DELIVERY'` is a new namespaced value in a partition already shared by `MASTERJOB_SAVED` and the visual-story keys. It cannot collide.

**TTL is a cleanup, not a control.** DynamoDB deletes expired items on its own schedule, which can lag by days. Expiry is enforced by comparing `expiresAt` on every request; the `ttl` attribute only stops the table accumulating dead rows.

## 5. Token

`crypto.randomBytes(32)` base64url-encoded — 256 bits, 43 characters. Not a UUID: v4 gives 122 bits and reads as guessable to anyone auditing this later.

The token IS the credential. There is no second factor, which is the correct trade for a link emailed to one buyer, and the reason the other controls (expiry, use cap, revocation, logging) all exist.

## 6. Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/d/[token]` | public | The page: filename, size, expiry, Download button |
| `GET` | `/api/d/[token]` | public | Validate, count, 302 → presigned S3 (60 s) |
| `POST` | `/api/admin/deliveries` | admin + bearer | Create a link |
| `GET` | `/api/admin/deliveries` | admin | List with download counts |
| `POST` | `/api/admin/deliveries/[token]/revoke` | admin + bearer | Kill a link early |

`src/middleware.ts` gates only paths starting with `/admin`, so the two public routes need no exemption — verified, not assumed.

The presign reuses `S3Operations.getSignedUrl(key, expiresIn, downloadAs)`, which already sets `Content-Disposition: attachment` with a UTF-8 `filename*`, so a Tamil filename survives the round trip.

### Counting

The count increments **when the redirect is issued**, using a conditional update so two simultaneous clicks cannot both pass a `downloadCount < maxDownloads` check:

```
UpdateExpression:    ADD downloadCount :one SET downloads = list_append(...)
ConditionExpression: downloadCount < :max AND attribute_not_exists(revokedAt)
```

A failed condition means the link is used up — return the page with that message rather than an error.

This counts **issued URLs, not completed downloads**, and the design accepts that. Section 2 explains why: nothing at this layer can observe completion. The three-use allowance exists precisely because the count is pessimistic.

## 7. Where deliverables live

A new prefix, `deliveries/`, in `tamil-web-media`, added to the existing bucket-policy Deny on the CloudFront principal — the same mechanism that already keeps `audio/mastering/*` off the CDN (`Sid: DenyCloudFrontOnMasteringWorkspace`).

That Deny is what makes this design meaningful. Without it a deliverable would remain fetchable over CloudFront regardless of the token, and every control here would be decorative.

**This work also removes the two karaoke files already published to `audio/karaoke/` on the CDN.** They are the exact exposure this feature exists to end.

## 8. Failure modes

Every case renders the page with a plain explanation. No raw errors, no stack traces.

**These messages deliberately DO distinguish between unknown, expired and used-up.** The usual argument for a single vague message is to stop an attacker learning which tokens existed — but that only matters when the token space is sweepable, and 256 bits is not. Meanwhile a buyer who is told "expired, ask for a new one" can act on it, and one told only "not valid" emails the operator confused. Helpfulness wins here; the entropy is what carries the security.

| Condition | Page says |
|---|---|
| Unknown token | This link is not valid. |
| Expired | This link has expired. Contact TamilAgaval for a new one. |
| Used up | This link has already been used. |
| Revoked | This link is no longer active. |
| S3 object missing | Something went wrong — logged server-side, generic to the buyer. |

Both public routes are rate-limited per IP with the existing `RateLimiter`, so the token space cannot be swept.

## 9. Security

- 256-bit token; the S3 key never reaches the client.
- Presigned TTL **60 s** — long enough to start a download, too short to be worth sharing. Once the download starts, S3 serves the whole object regardless of the URL expiring mid-transfer.
- Deliverables sit behind the CloudFront Deny (section 7).
- Every hit records timestamp and IP, so "he says it never arrived" has an answer.
- Revocation is immediate and checked in the same conditional update as the count.
- Admin routes: `requireAdmin()`, and `requireBearer()` on both mutations, following `/api/admin/compose`.

## 10. Files

**New**

```
src/types/delivery.ts                              client-safe types + zod
src/infrastructure/database/DeliveryRepository.ts  token CRUD, atomic count
src/app/d/[token]/page.tsx                         the public page
src/app/api/d/[token]/route.ts                     validate, count, redirect
src/app/api/admin/deliveries/route.ts              create + list
src/app/api/admin/deliveries/[token]/revoke/route.ts
src/components/admin/DeliveryManager.tsx           admin UI
src/app/(admin)/admin/deliveries/page.tsx
```

**Modified**

- `src/config/admin-nav.ts` and `AdminLayoutClient.tsx` — one nav entry. (Adding the page without a nav entry is the mistake made with `/admin/mastering/bulk`; do not repeat it.)
- The S3 bucket policy — add `deliveries/*` to the CloudFront Deny. An IAM/policy change, not a new resource.

**Not created:** no new table, no new GSI, no new bucket, no new Lambda, no new npm dependency.

## 11. Testing

- **Repository** — token generation length and alphabet; the conditional update refusing the fourth download; revocation blocking a download that would otherwise be within the cap.
- **Public route** — expired, used-up, revoked and unknown tokens each render their message; a valid token 302s and increments exactly once; the page render does NOT increment (the scanner case from section 3, and the one most likely to regress).
- **Admin routes** — auth rejection, bearer rejection on mutations, and that the created link's `s3Key` never appears in any public response body.
- **Types** — zod accepts a well-formed create and rejects each malformed field.

## 12. Out of scope

- Taking payment. Manual, per D4.
- Emailing the link. The operator sends it himself.
- Watermarking or per-buyer encoding.
- A buyer-facing account. The token is the credential, by design.
