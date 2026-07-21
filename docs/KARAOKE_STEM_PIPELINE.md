# Karaoke Stem Pipeline (Performers feature)

Produces a **subscriber-gated karaoke instrumental** for a published song by
separating the vocals out of its finished master with
[Demucs](https://github.com/facebookresearch/demucs) (Meta, **MIT-licensed**).
This is the audio half of the planned Performers feature; the crux you flagged —
*asset-level gating* — is modelled as a domain invariant, not left to a route.

Standing rule respected: this concerns the **instrumental only**. Lyrics are
never publicly displayed or altered. Any lyric pairing for karaoke is a
separate, equally gated asset (see "Next" below).

## Architecture (ports & adapters, DDD)

Heavy ML runs **offline/batch** — never in a request path — consistent with the
"no ML during render" rule.

```
scripts/generate-karaoke-stem.ts        ← CLI composition root (wires adapters)
        │
        ▼
GenerateKaraokeStem (application/use-cases)   ← orchestration, discriminated result
        │  depends only on interfaces (ports):
        ├── SongMasterSource            fetch master → local file   (→404 if absent)
        ├── StemSeparator               separate vocals            (swappable engine)
        ├── KaraokeInstrumentalStorage  upload to gated storage
        └── KaraokeAssetRepository      persist reference on the song
        │
        ▼
KaraokeAsset (domain/songs)             ← immutable value object + the GATE
```

| Layer | File |
|---|---|
| Domain | `src/domain/songs/KaraokeAsset.ts` — value object; `isAccessibleBy()` is the gate |
| Port (engine) | `src/application/ports/StemSeparator.ts` — swappable separator |
| Ports (feature) | `src/application/ports/karaoke.ts` — master source, storage, repository |
| Use case | `src/application/use-cases/GenerateKaraokeStem.ts` |
| Adapter (ML) | `src/infrastructure/audio/DemucsStemSeparator.ts` |
| Adapter (S3) | `src/infrastructure/storage/KaraokeInstrumentalStorage.ts` (private `performer-tracks/` prefix; returns the object **key**, not a URL) |
| Adapter (DB) | `src/infrastructure/database/DynamoKaraokeAssetRepository.ts` (additive attrs on `CONTENT#<id>`: `karaokeInstrumentalKey`, `karaokeAsset`, `karaokeAccess`) |
| CLI | `scripts/generate-karaoke-stem.ts` |

The `StemSeparator` port means the engine is swappable (a faster model, a hosted
API) without touching the use case — the same "prompt layer + swappable engine"
split used elsewhere.

## The gate

`KaraokeAsset.visibility` is fixed to `'subscribers'`; `isAccessibleBy({ isSubscriber })`
is the single source of truth. Routes and the player MUST consult it rather than
re-deriving the rule.

Crucially, the asset holds the **private S3 object key**, never a public URL —
`KaraokeAsset.create` throws if handed a `http(s)://` value. The media CDN
serves any public URL **unsigned**, so a gated instrumental must have no public
address; instrumentals live under the private `performer-tracks/` prefix (never
the public `audio/` prefix) and are streamed by a gated route that mints a
short-lived, same-origin URL only for entitled subscribers. `karaokeAccess` is
mirrored onto the song item so a read path can gate without rehydrating.

## 🔴 GO-LIVE GATE (BLOCKING) — CloudFront must not serve gated assets

This is **the** security control, not a footnote. App-layer gating protects the
app path only; it does nothing against a direct CDN fetch of a known key. The
gate must be **verified empirically** (an anonymous `curl` of a real key), not by
config inspection.

**Verified 2026-07-21 — RED (currently exposed):** an anonymous GET of a
`performer-tracks/` key via `https://d2cdoh43143xxa.cloudfront.net` returned
**200**. Cause: distribution `EV5MK0A02KLHV` has only the default `*` cache
behavior → S3, so the CDN serves **every** key unsigned. (S3 itself is fine:
public-access-block all `true`, origin locked to OAC — the hole is purely
CloudFront.)

Of the three required conditions — (1) S3 bucket not public ✅, (2) origin
locked to OAC ✅, (3) **no CloudFront behavior serves the prefix ❌** — condition
3 fails, so the boundary is open. Random-UUID keys would be obscurity, not a
boundary.

**Fix (pick one), then re-test:**
- **A (simplest, recommended):** store gated instrumentals in a **separate
  private bucket** with no origin on this public distribution; the app streams
  them server-side (IAM) via the gated route — they never need the CDN.
- **B:** add a CloudFront Function / behavior on `performer-tracks/*` that
  returns 403 to anonymous viewers (keeps one bucket).
- **C:** trusted-key-group signed URLs/cookies for that prefix (heaviest).

Until green, the code **fails closed**: `S3KaraokeInstrumentalStorage` refuses to
write unless `PERFORMER_ASSETS_BUCKET` is set to a bucket *other than* the media
bucket. `--publish` will error rather than expose an asset.

**Re-test command (must print 403):**
```bash
KEY=performer-tracks/_gate-probe-$(date +%s).txt
echo probe | aws s3 cp - "s3://$PERFORMER_ASSETS_BUCKET/$KEY" --content-type text/plain
curl -s -o /dev/null -w '%{http_code}\n' "https://d2cdoh43143xxa.cloudfront.net/$KEY"  # want 403
aws s3 rm "s3://$PERFORMER_ASSETS_BUCKET/$KEY"
```
(The unmerged `feat/performers-auth` branch hit this same trap; this pipeline
feeds that branch's gated stream route — see "Reconciliation" / "Next".)

## Requirements (offline box only — not Amplify)

```bash
pip3 install --user torch --index-url https://download.pytorch.org/whl/cpu
pip3 install --user demucs soundfile
# ffmpeg + ffprobe must be on PATH (already present on the dev box)
```

Amplify SSR cannot and must not run this — it's a batch/CLI step that produces a
baked artifact, exactly like `generate-song-short.ts`.

## Usage

```bash
# DRY RUN (default) — writes the instrumental locally, NO S3/DynamoDB writes.
# --audio accepts a local path OR an http(s) URL (CDN master).
npx tsx scripts/generate-karaoke-stem.ts \
  --song sevvizhi-oviyame \
  --audio "https://d2cdoh43143xxa.cloudfront.net/audio/poem-music/செவ்விழி ஓவியமே.mp3" \
  --out ~/karaoke/sevvizhi-instrumental.mp3

# PUBLISH — upload to the private performer-tracks/ prefix + record on the song.
# BLOCKED until the CloudFront go-live gate is green: requires a gated bucket.
PERFORMER_ASSETS_BUCKET=tamil-web-media-gated \
  npx tsx scripts/generate-karaoke-stem.ts --song sevvizhi-oviyame --audio <url> --publish
```

Options: `--python <bin>` (Python with demucs importable), `--model <name>`
(default `htdemucs`). On CPU, separation takes a few minutes per song.

## Verified run (2026-07-21, dry-run on "செவ்விழி ஓவியமே")

- Output: valid 192 kbps / 44.1 kHz stereo MP3, 274.9 s (master 274.8 s).
- Overall mean energy −16.5 → **−20.7 dB**; centre-channel vocal band (~200–4000 Hz)
  −28.3 → **−32.9 dB** — lead vocals removed, backing track intact (max −3.8 dB unchanged).

## Tests

Unit-tested with no torch/ffmpeg/S3/DynamoDB needed (seams are injected):

- `__tests__/unit/domain/KaraokeAsset.test.ts` — gating + construction invariants
- `__tests__/unit/application/GenerateKaraokeStem.test.ts` — orchestration + every failure→status mapping
- `__tests__/unit/infrastructure/DemucsStemSeparator.test.ts` — argv construction, stem resolution, failure modes
- `__tests__/unit/infrastructure/karaokeInstrumentalKey.test.ts` — gated key convention

```bash
npx jest __tests__/unit/domain/KaraokeAsset.test.ts \
         __tests__/unit/application/GenerateKaraokeStem.test.ts \
         __tests__/unit/infrastructure
```

## Next (remaining wiring, not in this change)

1. **Serving route** — a `/api/songs/[id]/karaoke` (or player hook) that checks
   the Cognito subscriber entitlement and `KaraokeAsset.isAccessibleBy(...)`
   before returning a short-lived signed CloudFront URL.
2. **Synced lyrics** — forced alignment (Montreal Forced Aligner + open-tamil
   syllabification) to time the *gated* lyrics to the instrumental for a karaoke
   highlight, surfaced with `wavesurfer.js`. Still subscriber-gated; still no
   public lyric display.
