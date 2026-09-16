# Stripe payments for karaoke orders — Design

- **Date:** 2026-09-16
- **Status:** Approved in chat. Implementation plan not yet written.
- **Scope:** Take payment for a karaoke order and deliver the file automatically, on `tamilagaval.com`.
- **Builds on:** `docs/superpowers/specs/2026-09-14-delivery-links-design.md` (PR #294) — the delivery half.

> ## ⚠️ This spec depends on TWO unmerged PRs
>
> Neither is optional, and nothing here can be built until both are on `master`:
>
> | PR | Gives this spec | Without it |
> |---|---|---|
> | **#294** delivery links | `DeliveryRepository`, the token flow, the expiring-link page | Payment succeeds and nothing can be delivered |
> | **#293** karaoke page | `src/lib/karaoke.ts` — `KARAOKE_PRICE`, `KARAOKE_SUBJECT`, the deliverable list; and `/karaoke` itself, which is where orders come from | No price constant to charge, and no form to order through |
>
> Verified 2026-09-16: `src/lib/karaoke.ts` does **not** exist on `master`. Merge both before writing a plan against this document.

---

## 1. Purpose

Sell a karaoke version and deliver it without the operator touching the transaction.

Today the flow is entirely manual: a buyer asks over WhatsApp, the operator agrees a price, sends a payment request by hand, waits, then sends a file. The first commission (CAD $80 agreed for two songs, 2026-09-12) is still unpaid four days later, and the deliverable sat on a public CDN URL until it was locked down on 2026-09-16.

This replaces the middle of that with Stripe Checkout, and the end of it with an expiring link created automatically when the money lands.

**Explicitly reverses decision D4 of the DELIVERY-LINKS spec** (that document's numbering; this one's decisions are S1-S7 below, to keep the two apart), which read: *"Payment gating — Manual: the operator creates the link after payment lands. Rejected: Stripe or other webhook."* That was correct when there was no payment infrastructure. There is about to be.

## 2. What stays manual, and why

The operator **approves each order before a payment link is sent**.

This is not caution for its own sake. Karaoke is built by summing the non-vocal stems of a song, and **stems are not held for the whole catalogue** — they are fetched per order. On 2026-09-14 the stems for செவ்வந்தி பூவே were found and the stems for ஈழத்து மண்ணே were not. An order taken for a song whose stems cannot be obtained is a refund, and a refund is worse than a slower yes.

So the buyer's request is a request. The operator confirms the song can actually be built, and only then does money move.

## 3. Decisions locked before writing this spec

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| S1 | Order state | **A `KARAOKEORDER#` row with a forward-only status** | Stripe as the source of truth; reusing `CONTACT_MESSAGE` |
| S2 | Fulfilment | **Webhook creates and emails the link automatically** | Notify the operator, who sends it by hand |
| S3 | Refunds | **Stripe dashboard only — no refund capability in this app** | A button in the admin panel; no refund path at all |
| S4 | Approval | **A confirm step naming song, file and price** | One-click approve |
| S5 | Stripe account | **TechSynergy account, Tamilagaval as an entity** | A separate Tamilagaval account |
| S6 | API key | **A restricted key with `Checkout Sessions: write` and NOTHING else** | A full secret key; adding `Refunds: write` |
| S7 | Price source | **Server-side constant only** | Anything the browser submits |

### Why an order entity rather than Stripe as the source of truth

Stripe retries a webhook for up to three days on any non-2xx response. A retry that re-runs fulfilment emails a **second download link for one payment**.

The status field is the idempotency guard. The transition `approved → paid` is a **conditional** DynamoDB write: it succeeds exactly once, and every retry afterwards finds the condition unmet and stops. Deduplicating on Stripe event ids is a second layer, not the primary one — event ids protect against the same event twice, but not against two different events (`checkout.session.completed` and `payment_intent.succeeded`) both trying to fulfil the same order.

It also means "where is this order" is answerable from the operator's own admin panel rather than by logging into a shared parent-company Stripe account.

### Why the key is checkout-only, and why refunds are not in this app

**Corrected 2026-09-16 after review.** An earlier draft of this spec claimed a restricted key limits the blast radius *between entities*. That is wrong, and the error mattered enough to change a decision.

**Stripe restricted keys scope by resource type, not by entity or metadata.** A key carrying `Refunds: write` can refund **any** charge on the TechSynergy account, Mobily's included. The `metadata.entity` tag is a bookkeeping label; it grants and restricts nothing. Only a separate Stripe account, or Connect with a connected account per entity, actually partitions the money — and S5 chose neither.

Given that, the permission set is the whole defence, so it is cut to the bone:

| Capability | In the key? | Why |
|---|---|---|
| Checkout Sessions: write | **yes** | The one thing the app must do |
| Refunds: write | **no** | This is the dangerous one — see below |
| Customers, Products, Prices, Payouts, Balance, Invoices | no | Never used. The price is built inline via `price_data`, so no Price object is read |
| Webhook verification | n/a | Uses the signing secret, not the API key |

**A leaked checkout-only key is close to harmless**: the worst an attacker achieves is creating payment pages that collect money *into* the account. A leaked key with `Refunds: write` moves money *out*, across every entity on a shared account, and an internet-facing Next.js app is exactly where a key leaks from.

Refunds are rare, deliberate, and worth pausing over. Doing them in the Stripe dashboard costs a minute a few times a year and removes the only genuinely dangerous permission from the app. The admin panel still **displays** refunded state — read back from the order row, updated by the `charge.refunded` webhook — it simply cannot issue one.

### Why the entity tags matter on a shared account

Because payments land in TechSynergy's balance, two things are required and are not optional niceties:

- `metadata.entity = 'tamilagaval'` on every Checkout Session, so Tamilagaval revenue can be reconciled out of a shared ledger at year end.
- `statement_descriptor_suffix` of `TAMILAGAVAL`, because a buyer who sees only the parent company's name on their card statement does not recognise it — and an unrecognised charge is a chargeback, which costs the fee plus a dispute.

## 4. Architecture

```
Buyer                    tamilagaval.com                      Stripe
  │
  ├─ POST /api/karaoke/request ──► KARAOKEORDER#  status=requested
  │                                 └─ email to operator
  │
  │        operator opens /admin/karaoke, confirms song + file + price
  │                                        │
  │                                        ├─ Checkout Session ──────────►
  │                                        │   (price server-side,
  │                                        │    metadata.entity,
  │                                        │    metadata.orderId)
  │                                        └─ status=approved
  │ ◄──── email: pay here ─────────────────┘
  │
  ├─ pays ───────────────────────────────────────────────────────────────►
  │                                                                       │
  │              POST /api/stripe/webhook  ◄────────────────────────────── ┘
  │                 ├─ verify signature over the RAW body
  │                 ├─ conditional write approved → paid   (succeeds ONCE)
  │                 ├─ create delivery link  (DeliveryRepository, PR #294)
  │                 ├─ email the link to the buyer
  │                 └─ status=delivered, return 200
  │
  └─ ◄──── email: your download link (3 downloads, 7 days) ───────────────
```

### Prior art this must follow, not reinvent

`src/app/api/twitch/eventsub/route.ts` already solves the same class of problem and its shape is the template:

- **Lives outside `/api/admin`.** `middleware.ts` guards `/admin*` only. The signature *is* the authentication; Stripe cannot log in. A future reader who "secures" this route behind admin auth breaks it completely — the route comment must say so.
- **Reads the raw body** with `await request.text()`, never `request.json()`. Signature verification runs over the exact bytes sent. Getting this wrong fails two ways: verification always fails, or someone "fixes" it by skipping verification and the endpoint becomes a way for anyone to mark orders paid.
- **Rejects with 403 and no body** on a bad signature or a stale timestamp. A stale-but-correctly-signed request is a captured replay.
- **Dedupes by message id** before doing work.
- **Returns 200 even when downstream work fails**, because a non-2xx triggers a retry, and a retry after the link already exists is how a buyer gets two.

## 5. Components

### `src/types/karaokeOrder.ts` (new)

```
status: 'requested' | 'approved' | 'paid' | 'delivered' | 'refunded' | 'failed'
```

Forward-only. Fields: buyer name/email, song title, notes, `karaokeS3Key` (set at approval), `stripeSessionId`, `stripePaymentIntentId`, `deliveryToken`, `amountCents`, `currency`, `entity`, timestamps per transition, `lastError`.

### `src/lib/karaoke-order.ts` (new, pure)

The state machine and its legal transitions, plus `planApproval()` and `planFulfilment()` mirroring `planRender` / `planUpload`. Pure, so every transition is testable without Stripe or a database.

### `src/lib/stripe/` (new)

`client.ts` reads the restricted key from SSM at runtime (the `twitch/tokens.ts` pattern). `checkout.ts` builds a Session — **price from `KARAOKE_PRICE` in `lib/karaoke.ts`, never from input** — carrying `metadata.orderId`, `metadata.entity` and the statement descriptor. `verify.ts` is pure signature verification over a raw body string, testable with fixtures and no network.

### `src/infrastructure/database/KaraokeOrderRepository.ts` (new)

`create`, `get`, `findByStripeSessionId`, `listOpen` (sparse GSI partition `KARAOKEORDER_OPEN`, following the `MASTERJOB_SAVED` idiom), and one **conditional** transition method per state change.

### `src/app/api/stripe/webhook/route.ts` (new)

Handles `checkout.session.completed` and `charge.refunded` in this phase. The second exists only so a refund made in the Stripe dashboard is reflected in the admin panel — the app never issues one. Everything else is acknowledged with 200 and ignored — on a shared account this endpoint will receive events that belong to other entities, and it must ignore them silently rather than error.

### `src/app/(admin)/admin/karaoke/page.tsx` + routes (new)

The order list. Approve (with the S4 confirm step). **No refund control** — per S3, refunds happen in the Stripe dashboard. Refunded orders display that state with a link out to the charge in Stripe.

## 6. Error handling

| Failure | Behaviour |
|---|---|
| Bad signature, or timestamp outside the replay window | 403, no body, nothing written |
| Event for another entity, or an order id we don't hold | 200, ignored — expected on a shared account |
| Order already `paid`/`delivered` | Conditional write fails, 200, no second link, no second email |
| Delivery-link creation fails | Order → `failed` with `lastError`; **200 returned**; surfaced in the admin panel for manual delivery |
| Email fails after the link was created | Link still exists and is visible in the panel; order records the email failure; **200 returned** |
| Stripe API unreachable at approval | Approval fails loudly in the admin UI; order stays `requested`; nothing was charged |
| A refund is made in the Stripe dashboard | `charge.refunded` arrives; order → `refunded`. The app never initiates this, so there is no refund failure path to handle |

**The rule behind the table:** a webhook returns 200 unless the *signature* was bad. Everything else is recorded and surfaced, because a retry is more dangerous than a missed notification — the money is already taken either way, and the operator can always deliver by hand from the panel.

## 7. Testing

- `karaoke-order.ts`: every legal transition, and that illegal ones are refused. Pure.
- `stripe/verify.ts`: a known-good fixture passes; a tampered body fails; a stale timestamp fails. No network.
- `stripe/checkout.ts`: the price comes from the constant and **cannot** be overridden by input; `metadata.entity` and the statement descriptor are always present.
- Webhook route: valid event fulfils exactly once; **the same event twice fulfils once**; an unknown order id returns 200 without writing; a bad signature returns 403.
- Repository: the conditional transition succeeds once and fails the second time.
- Admin routes: `requireAdmin` + `requireBearer`, and approval requires an explicit confirm flag (S4).
- **A test that the app has no refund capability**: no route, client or helper calls Stripe's refund API. This is a permission the key does not carry, so code that tried would fail at runtime in production while passing any mocked test — the guard has to be that the call site does not exist.

**jest, not vitest.** Never pipe a test run to `tail` — it swallows the exit code.

## 8. Operator steps, outside the code

1. Generate a **restricted key** for Tamilagaval under the TechSynergy account with **`Checkout Sessions: write` and nothing else**. Do NOT add `Refunds: write` — see S6. If a refund is ever needed, issue it from the Stripe dashboard.
2. `aws ssm put-parameter --type SecureString --name /amplify/d3rkmepk4popv0/master/STRIPE_SECRET_KEY`
3. After the route is deployed, create the webhook endpoint in Stripe pointing at `https://tamilagaval.com/api/stripe/webhook`, subscribed to `checkout.session.completed` and `charge.refunded`.
4. Put the resulting signing secret in SSM as `STRIPE_WEBHOOK_SECRET`. **It does not exist until step 3.**
5. Take the first payment in Stripe **test mode** and watch it end to end before switching to live.

## 9. Not in scope

Subscriptions, multi-item carts, coupons, tax calculation, invoicing, and self-serve checkout without operator approval. Each is a separate decision; none is needed to take a first payment.
