# Songs Upload — Notes & Action Items

_Captured 2026-05-27. Diagnosis of the "uploaded 2 songs but nothing plays" issue + how to fix._

## TL;DR
Your 2 audio files **did** upload to S3 and are publicly playable — but **no song record links to them** (`audioUrl` is empty on every song), so the player has nothing to play. Attach the URLs below to a song and they'll work.

---

## 1. Ready-to-paste audio URLs (no re-upload needed)

The audio is already in S3 (verified: HTTP 206, `audio/wav`, range/seeking works). Just attach each URL to a song.

**அந்தி மேகமே** (70 MB)
```
https://tamil-web-media.s3.us-east-1.amazonaws.com/audio/poem-music/%E0%AE%85%E0%AE%A8%E0%AF%8D%E0%AE%A4%E0%AE%BF%20%E0%AE%AE%E0%AF%87%E0%AE%95%E0%AE%AE%E0%AF%87.wav
```

**அருவி முத்தம்** (41 MB)
```
https://tamil-web-media.s3.us-east-1.amazonaws.com/audio/poem-music/%E0%AE%85%E0%AE%B0%E0%AF%81%E0%AE%B5%E0%AE%BF%20%E0%AE%AE%E0%AF%81%E0%AE%A4%E0%AF%8D%E0%AE%A4%E0%AE%AE%E0%AF%8D.wav
```

### How to attach
1. **Admin → New Content** → Type: **பாடல்கள் (Songs)**
2. Fill **Title** + **Author** (Author = the artist shown in the player)
3. **Media → Audio File** → **paste** one URL above into the field (it accepts a URL, no Upload needed)
4. *(optional)* set **Audio Duration (seconds)** so the track time shows
5. **Status: Published → Save.** Repeat for the second song.

---

## 2. Why it didn't work

- The files landed under the **`audio/poem-music/`** prefix — that's the page's **"generate / listen" (TTS)** cache, **not** the admin song uploader.
- The thing that makes a song playable is its **`audioUrl`** field. The song uploader's **Audio File** control (Upload *or* paste-URL) is what sets it. The TTS/generate flow does not.
- Result: audio exists in storage, but it's orphaned — not connected to any song.

## 3. Recommendation: use MP3, not WAV
These are uncompressed **WAV** (70 MB & 41 MB). They play, but every visitor downloads the full file. **Re-export as MP3** (~5–7 MB each) and upload via the **Upload** button — ~10× smaller and far better for streaming. The pasted-WAV approach above is fine for a quick test.

## 4. Current data state (FYI)
- The database currently has **1 published song** ("பூ வாசம்", no audio) + 2 poems — none with audio.
- The live `/songs` page is showing a **stale 5-min cache** (ISR `revalidate=300`).

---

## 5. Open issue — region split (data hygiene, not urgent)
Content is split across **two `TamilWebContent` DynamoDB tables**:
- **us-east-1** — the live table the app reads/writes (1 song + 1 poem).
- **ca-central-1** — a stray copy (1 poem). Plus the duplicate table itself.

Recommend **consolidating to one region** (us-east-1, matching the S3 bucket) before adding lots of content, to avoid confusion. Can be done as a separate task.

## 6. What Claude will do on request
- **Force an instant refresh** (redeploy) after you attach audio, so the song shows immediately instead of waiting for the 5-min cache.
- **Verify the player + cross-page persistence** live once a song has audio.
- **Consolidate the two regions** (data-hygiene cleanup) if you want.
