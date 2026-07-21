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
| Adapter (S3) | `src/infrastructure/storage/KaraokeInstrumentalStorage.ts` (private gated bucket, `performer-tracks/` prefix; returns the object **key**, not a URL; fails closed) |
| Adapter (DB) | `src/infrastructure/database/DynamoKaraokeAssetRepository.ts` — delegates to `setPerformerAssets({ instrumentalKey, instrumentalDuration })` so the Performers stream route serves it (no parallel schema) |
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

## GO-LIVE GATE — CloudFront must not serve gated assets (Option A applied)

This is **the** security control, not a footnote. App-layer gating protects the
app path only; it does nothing against a direct CDN fetch of a known key. The
gate is **verified empirically** (an anonymous `curl` of a real key), never by
config inspection.

**Background (2026-07-21, RED):** the media bucket `tamil-web-media` is fronted
by distribution `EV5MK0A02KLHV` (`d2cdoh43143xxa.cloudfront.net`) whose only
cache behavior is the default `*` → S3, so an anonymous GET of a
`performer-tracks/` key returned **200**. S3 itself was fine (public-access-block
all `true`, origin locked to OAC); the hole was purely CloudFront serving every
key.

**Fix applied — Option A (remove the surface, don't guard it):** gated
instrumentals live in a **separate private bucket that is not an origin on the
public distribution**, so they are unreachable via CloudFront *by construction*
— no prefix rule to keep correct, nothing to regress. This matches what the
Performers feature already does: stream server-side via `requirePerformer`, never
a CDN URL.

**Provisioned:** `PERFORMER_ASSETS_BUCKET=tamil-web-media-gated` (us-east-1;
public-access-block all `true`; SSE-S3; NOT added to `EV5MK0A02KLHV`).

**Verified GREEN 2026-07-21** (anonymous, a real key):
- via CloudFront → **403** (bucket is not an origin on the distribution)
- direct S3 → **403** (public access blocked)
- old `performer-tracks/` prefix in the media bucket → **empty** (nothing lingers)

The code also **fails closed**: `S3KaraokeInstrumentalStorage` refuses to write
unless `PERFORMER_ASSETS_BUCKET` is set to a bucket *other than* the media
bucket — config and code agree.

**Remaining infra for go-live:** grant the app's runtime IAM identity
(`APP_AWS_*`) `s3:GetObject` on `arn:aws:s3:::tamil-web-media-gated/*` so the
gated stream route can read it (the offline pipeline's `mobily-web` identity can
already write).

**Re-test command (must print 403):**
```bash
KEY=performer-tracks/_gate-probe-$(date +%s).txt
echo probe | aws s3 cp - "s3://$PERFORMER_ASSETS_BUCKET/$KEY" --region us-east-1 --content-type text/plain
curl -s -o /dev/null -w '%{http_code}\n' "https://d2cdoh43143xxa.cloudfront.net/$KEY"  # want 403
aws s3 rm "s3://$PERFORMER_ASSETS_BUCKET/$KEY"
```

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

# PUBLISH — upload to the private gated bucket + record via setPerformerAssets.
# The gated bucket is us-east-1, so an offline run must pin the region too.
PERFORMER_ASSETS_BUCKET=tamil-web-media-gated PERFORMER_ASSETS_REGION=us-east-1 \
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
- `__tests__/unit/infrastructure/karaokeInstrumentalKey.test.ts` — gated key convention + fail-closed bucket guard
- `__tests__/unit/infrastructure/DynamoKaraokeAssetRepository.test.ts` — persists via `setPerformerAssets` (no parallel schema)

```bash
npx jest __tests__/unit/domain/KaraokeAsset.test.ts \
         __tests__/unit/application/GenerateKaraokeStem.test.ts \
         __tests__/unit/infrastructure
```

## Next (remaining, not in this change)

1. **IAM grant (go-live):** app runtime identity (`APP_AWS_*`) needs
   `s3:GetObject` on `arn:aws:s3:::tamil-web-media-gated/*` so the existing gated
   stream route (`GET /api/performers/songs/[id]/track`, `requirePerformer`) can
   read the new bucket. This is the last blocker before publishing.
2. **Serving route already exists on this branch** — the generation pipeline now
   writes `instrumentalKey` via `setPerformerAssets`, which that route serves.
   Nothing new to build; just point it at the gated bucket (region us-east-1).
3. **Synced lyrics** — forced alignment (Montreal Forced Aligner + open-tamil
   syllabification) to time the *gated* lyrics to the instrumental for a karaoke
   highlight, surfaced with `wavesurfer.js`. Still subscriber-gated; still no
   public lyric display.
