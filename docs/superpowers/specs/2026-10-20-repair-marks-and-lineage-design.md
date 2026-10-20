# Repair marks and version lineage — design

**Date:** 2026-10-20
**Status:** section 1 approved in conversation; Raj said "go with your plan" for the rest; awaiting review of this written spec
**Scope:** track 2 of the Repair Studio work. Track 1 (one output file per job) shipped as PR #390. Track 3 (a pitch-contour prototype on the Python Lambda) is a separate spike.

## Purpose

Raj judges a song while listening. The saved-master player already lets him press **M** to drop a mark with a reason (pronunciation, melody, mixing and so on) and a note, and drag the waveform to loop a span. But marks live only in the page and vanish when it closes, only one span exists at a time and it is never saved, and a stem remix becomes a new master with no record of where it came from.

This design makes those judgements durable and connects versions:

1. **Saved marks.** Every mark is stored against the saved master it was made on.
2. **Saved spans.** A looped region can be saved as a mark with a start and an end.
3. **Status.** Each mark is Open, Fixed or Won't fix, so a repair can be checked off.
4. **Lineage.** A new master records which master it came from, and how.

It changes no audio. Marks and lineage are notes about versions, never edits to them.

### What Raj chose

| Question | Choice |
| --- | --- |
| What a mark belongs to | **The version** (saved master) being listened to. A new version starts clean and shows its parent's marks greyed out. |
| Moments vs spans | **One list.** A mark is a moment or a span. |
| Progress | **Status per mark:** Open, Fixed, Won't fix. |
| Storage | **One record per mark** (approach A). |
| Out of scope (Raj, 2026-10-20) | FastAPI, always-on servers, GPU, compression, exportable EQ. |

### Why marks belong to a version, not the song

Each master has its own timeline. A re-master with a different trim, or a remix, puts the same sung word at a different second. A song-wide list would show marks at the wrong time on every version but one. So a mark's time is exact for its own version, and a child version shows its parent's marks as a list (with the parent's times), not on its own waveform.

## Section 1: What gets stored

### A mark

One DynamoDB item per mark, in the existing single table:

`PK = MARKS#<masterJobId>`, `SK = MARK#<markId>`, `Type = 'MASTERMARK'`

| Field | Type | Meaning |
| --- | --- | --- |
| `markId` | string | `randomUUID()` |
| `masterJobId` | string | The saved master it belongs to |
| `start` | number | Seconds into that master, ≥ 0 |
| `end` | number \| null | Null for a moment; > `start` for a span |
| `reason` | `MarkReason` | The existing `FAILURE_REASONS` vocabulary, unchanged |
| `note` | string | Free text, ≤ 500 characters |
| `status` | `'open' \| 'fixed' \| 'wont-fix'` | Defaults to `open` |
| `fixedIn` | string \| null | The child master whose listening confirmed the fix |
| `version` | number | Starts at 1; every update increments it |
| `createdAt`, `updatedAt` | ISO string | |

The partition mirrors `STEMSET#<masterJobId>`: a sibling of the master's record, never inside it. So:

- Writing a mark never touches `MASTERJOB#…` and therefore never moves its `updatedAt`, which the YouTube upload guard reads.
- Scans and the saved-masters GSI that read `MASTERJOB#` rows are unaffected (no new `GSI1PK` is written).
- Two tabs adding marks at once write two different items; nothing is read-modify-written.

**Limits:** 500 marks per master (refused beyond that); `note` ≤ 500 characters; `end − start` ≤ the master's duration when it is known.

### Lineage on the master

One optional field on the `MASTERJOB#<id>` record, written once when the job is created and never changed:

```ts
derivedFrom?: {
  jobId: string;                       // the parent saved master
  via: 're-master' | 'stem-remix';
  mixUsed?: Record<string, StemMixEntry>; // stem-remix only: the stem volumes the remix was rendered with
} | null
```

- **re-master:** Raj reopened a saved master (`reopenMaster`) and mastered its source again, perhaps with a new trim, join or target.
- **stem-remix:** Raj pressed **Master this remix** on the parent's stem set.
- `mixUsed` is copied from `STEMSET#<parent>.remix.mixUsed` at job creation. The mixer can change afterwards; the record keeps what this version was actually made from.

Jobs written before this ships have no `derivedFrom`; every reader treats it as optional.

## Section 2: Recording lineage

The client says which master a new job came from; the **server verifies it** before writing it.

- `reopenMaster(m)` remembers `m.id` as the pending parent. Picking a new file, `reset`, or another reopen clears it.
- The **Master this remix** link gains `&parent=<masterJobId>`. The `?source=` handler reads it into the same pending-parent state.
- `POST /api/admin/music-lab/master` accepts an optional `derivedFrom: { jobId }`.

The route decides `via` itself and refuses a claim it cannot verify:

| Check | Result |
| --- | --- |
| Parent job missing or not saved | 400 `bad-parent` |
| `s3Key` equals the parent's stem set `remix.key` | `via: 'stem-remix'`, `mixUsed` copied |
| `s3Key` equals the parent's `s3Key` | `via: 're-master'` |
| Neither | 400 `parent-mismatch` |

A 400 means a client bug, not an operator mistake, so failing loudly is right: a master recorded against the wrong parent would show the wrong marks forever. No `derivedFrom` in the body behaves exactly as today.

No worker change. The worker never reads or writes `derivedFrom`.

## Section 3: In the player

All of this is in `MasteringPlayer` when it plays a **saved** master from the library (it receives a new optional `masterJobId` prop). Where the player is used without one, marks stay session-local exactly as today.

**Marks list (this version):**
- **M** drops a moment mark, as today, and now saves it.
- **Save span** appears while a loop region is set; it saves the region as a span with the selected reason.
- Each row: time (or `1:42–1:49`), reason, note (editable in place), status (Open / Fixed / Won't fix), delete.
- Spans draw as shaded bands on the waveform; moments stay amber ticks.
- **Copy marks** keeps working (`marksToText`), now including spans and status.
- A save that fails shows the error **in that row**, not elsewhere on the page (the lesson recorded as "row errors must render in the row").

**From the previous version** (only when this master has `derivedFrom`):
- A second list showing the parent's marks with the parent's times, greyed, Open ones first, and a line saying "Re-master of …" or "Remix of …".
- Each Open parent mark has **Fixed here** (sets the parent mark to Fixed and `fixedIn` to this master) and **Still there** (copies it as a new Open mark on this version at the same time; Raj adjusts the time if the timeline moved).

**Library row:** a master with `derivedFrom` shows "Remix of *title*" or "Re-master of *title*" under its name.

## Section 4: API

All routes use `requireAdmin`, as the stems routes do.

| Route | Does | Errors |
| --- | --- | --- |
| `GET /api/admin/music-lab/master/[jobId]/marks` | List, sorted by `start` | 404 job missing |
| `POST …/marks` | Create `{ start, end?, reason, note? }` → 201 + mark | 400 invalid, 404 missing, 409 `not-saved`, 409 `too-many` |
| `PATCH …/marks/[markId]` | `{ version, note?, status?, reason?, start?, end?, fixedIn? }` | 400 invalid, 404 missing, **409 `stale`** when `version` ≠ stored |
| `DELETE …/marks/[markId]` | Remove | 404 missing |

`fixedIn`, when set, must name a saved master whose `derivedFrom.jobId` is this mark's master (400 `bad-fixed-in` otherwise), so a fix can only be credited to a real child version.

`PATCH` is a conditional update (`version = :expected`); on conflict the client reloads the list and says "Changed in another tab — reloaded". Create uses `attribute_not_exists(PK)`.

Validation lives in a pure module, `src/lib/repair-marks.ts`, beside the existing `audition-marks.ts` helpers it reuses (`formatMarkTime`, `reasonLabel`, `dominantReasons`). Persistence is `src/infrastructure/database/MarkRepository.ts`, using `DynamoDBOperations.query/put/update/delete` like `StemSetRepository`.

## Section 5: Testing

Written first, in the existing jest patterns.

- **Pure (`repair-marks`):** validation (moment vs span, `end > start`, limits, unknown reason, status values); sort order; text export with spans and status; the parent-marks view (open first).
- **Repository:** create is conditional; PATCH with a stale `version` throws the stale error and writes nothing; query returns only that master's marks.
- **Routes:** admin required; unsaved master → 409; 501st mark → 409; stale PATCH → 409; `fixedIn` naming a non-child → 400; delete of a missing mark → 404.
- **Lineage (master route):** remix key + parent → `stem-remix` with `mixUsed` copied; same source + parent → `re-master`; mismatch → 400 and **no job created**; unsaved parent → 400; no `derivedFrom` → unchanged behaviour.
- **Concurrency:**
  - Two creates on one master at once → both stored.
  - Two PATCHes carrying the same `version` → exactly one succeeds, the other gets 409.
  - Two re-masters of one parent created at once → two jobs, both with the same `derivedFrom`, and (with PR #390) two different output files.
- **Player:** with `masterJobId`, M saves through the API and a failure renders in the row; without it, behaviour matches today's tests.

CI as always: `tsc --noEmit`, `npm run lint`, full jest.

## Section 6: Migration, deploy and rollback

- **Migration: none.** New records only; `derivedFrom` is optional. Existing masters start with no marks and no recorded parent. Old marks never existed outside the page, so there is nothing to import.
- **Deploy:** web app only, through the normal Amplify build on merge. **No worker deploy.**
- **Order:** one PR, or two (marks first, then lineage); either is independently safe.
- **Rollback:** revert the PR(s); Amplify rebuilds. `MARKS#` items stay in the table, unread and harmless, and come back into use if the change is re-applied. `derivedFrom` on jobs created in between is ignored by the old code. Nothing to undo in S3.

## Out of scope

- Pitch contour analysis (track 3, a separate prototype).
- Any audio processing on a mark or span (repair tools, vocal replacement). Spans are stored so later tools have a target; this design adds no tool.
- Marks on unsaved jobs, on stems, or in the compare player.
- Lineage for karaoke beds made outside the pipeline (they have no job record).
- Showing parent marks on the child's waveform (times differ between versions).
