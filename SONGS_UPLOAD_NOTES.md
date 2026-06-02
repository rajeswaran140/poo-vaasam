# Songs Upload — Resolution & Notes

_Updated 2026-05-28. The two songs are now live on /songs, and the admin create/upload path is fixed._

## TL;DR — DONE
Both songs are **published and playable** on https://tamilagaval.com/songs:
- **அந்தி மேகமே** (`cnt_1779939400084_vgk04g3q9`)
- **அருவி முத்தம்** (`cnt_1779939400328_g850xot1y`)

They were created via the live admin API using the audio already in S3. Title/author/body were set to sensible placeholders (`author = ரஜேஸ்வரன் தங்கராஜா`, body = a short Tamil line) — **edit them in Admin → Content** to add real lyrics/credits.

---

## What was actually wrong (three separate bugs)

1. **Amplify config was v6-shaped on a v5 library.** `src/lib/amplify-config.ts` used `Auth: { Cognito: {...} }` (Amplify v6) but the project runs **aws-amplify v5.3.33**, which reads `Auth.{region,userPoolId,userPoolWebClientId}` flat. The Auth module was never configured → `Auth.currentSession()` failed → no token. **Fixed:** flat v5 config.

2. **Tokens lived in localStorage, but the server only reads cookies.** v5 defaults to localStorage. `src/middleware.ts` gates `/admin` on a Cognito *cookie*, and the API reads the idToken *cookie*. So you only reached `/admin` on a stale leftover cookie and every admin call was rejected ("no token presented"). **Fixed:** configured v5 `cookieStorage` (domain `tamilagaval.com`, Secure, SameSite=Lax). **→ You must sign out and sign back in once** so the session is written to cookies.

3. **The live DynamoDB table was missing `GSI5`.** The create path calls `findBySlug`, which queries **GSI5** (slug → content). Neither `TamilWebContent` table had it, so creates 500'd with _"table does not have the specified index: GSI5"_. **Fixed:** added GSI5 (GSI5PK/GSI5SK, projection ALL) to **ca-central-1/TamilWebContent**.

The "image upload unauthorized" error was the same token problem (#1/#2) on the presign endpoint — fixed by the same change.

---

## Region facts (corrected — the earlier note here was wrong)
- **The live table is `TamilWebContent` in ca-central-1.** The SSR Lambda runs in ca-central-1, so the injected `AWS_REGION` drives the single-region DynamoDB client. (Verified: live `/poems` shows the ca-central-1 row "அம்மா".)
- A second `TamilWebContent` in **us-east-1** (8 items, incl. an orphan song "பூ வாசம்" with no audio) is **not read by the site**. It's stale — migrate the useful rows to ca-central-1 and delete the rest as a cleanup task.
- **S3 is pinned to us-east-1** (`tamil-web-media`), so media URLs are us-east-1 even though content data is ca-central-1. That's expected.

## Recommendation: MP3, not WAV
The current audio is uncompressed **WAV** (70 MB & 41 MB) — they stream (HTTP 206) but every visitor downloads the whole file. Re-export as **MP3** (~5–7 MB) and re-upload via the admin uploader for ~10× smaller, faster playback. Updating the `audioUrl` in the song edit form is all that's needed.

> **TASK — transcode the catalogue to MP3.** As of 2026-06-02, 9 of 11 songs in
> `s3://tamil-web-media/audio/poem-music/` are still WAV (41–74 MB each),
> including the newest, **அரிதான பெரும் பாசம்.wav** (55 MB,
> `cnt_1780419293978_31gt0nq13`). For each: re-export to MP3, upload via the
> admin uploader (or to the same S3 prefix), and update the song's `audioUrl`.
> Only `முத்தமிழின் மூன்றெழுத்தில்` and `முடிவில்லா முகத்தினில்` are already MP3.
> (Transcoding/re-upload is a manual step — not done in code.)

## Open follow-ups
- **Re-login once** to migrate your session into cookies (required after the fix).
- **Consolidate the two regions** (move/clean up the stray us-east-1 table). GSI5 only exists on ca-central-1.
- Optional pre-launch: aws-amplify v5→v6 migration (clears npm vulns); set `ADMIN_EMAILS` to tighten RBAC.
