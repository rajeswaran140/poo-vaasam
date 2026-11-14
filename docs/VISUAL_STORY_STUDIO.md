# Visual Story Studio — operator guide

For the person running the admin. Admin page: **Visual Story** (`/admin/visual-story`). The same text, shorter, is in the admin docs (`/admin/docs`). The engineering design is `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md`.

## What exists today

Phases 2–6: storyboard a music video, make a still picture and a **video clip** for each shot, and **render the finished video**: every shot's chosen picture or clip joined with the song. **Not built yet:** a review step for choosing between several clips.

## Workflow

**Finding your way.** The story list shows each story as a card with its first picture, shape and length, how many shots are ready, and **Video ready** once it has a finished video. In a story, the **steps** under the title (Storyboard → Fill the song → Choose pictures or clips → Render video) tick off as you go and mark the next one. The **song timeline** below them shows every shot in order, its width by its length, with its chosen picture (or **▶ Clip**) and an amber **Choose** where nothing is chosen yet; press a shot to open it. Previews in the shot cards are large and in the story's own shape, and the chosen one is outlined and reads **✓ Chosen**.

### 1. Create
**New from master.** Pick a saved master, then the part of the song to film: **30 seconds to 7 minutes** (420 s), whole seconds, inside the finished song — most whole songs fit. Pick **16:9** or **9:16**; this cannot be changed later. Set the story's **budget** (default **$40**), and optionally its **Style**.

**Style** is one line, for example "warm cinematic film, golden-hour light, 35mm". It is added to every picture and clip request and given to the storyboard draft, so the look stays the same from shot to shot. Change it any time with **Edit style** under the title (empty = no style); pictures and clips already made keep the look they were made with.

### 2. Draft
Open the story and use **Draft storyboard**: paste the lyrics and press the button. The draft runs in the background and takes **about a minute** for a short window and up to **7 minutes** for a whole song (the panel says "Drafting… this takes about a minute." and the button stays disabled until it finishes). The new draft then appears in the panel with how much of your window it fills; review it, then apply. Applying **replaces** the current storyboard (its scenes, shots and their stills) and asks first. Characters are kept.
- The lyrics are used for that request only and are **not stored**. Paste them again for another draft.
- The button shows the most the draft can cost: **≈$0.15** for a short window, up to about **$0.32** for a whole song (it writes more). That much is held against the budget while it runs; only the actual cost counts toward the story total. A real draft costs less — a few cents for a short window (about $0.05–0.06 for 2 minutes, measured 2026-11-04).
- If a draft has not finished after 15 minutes it is marked failed ("The draft took too long. Please try again.") and its hold is released — at the latest the next time the story is opened or another draft is started.
- The most recent draft is listed by date when you reopen the story.

### 2b. Check the storyboard
Once a story has shots, **Check storyboard** sits above them. Press it before you spend on pictures and clips: Claude reads every shot (each prompt goes to Grok on its own, so it looks for what Grok would get wrong) and lists the problems, each with a **Try:** fix. It changes nothing; press **Scene X, shot Y** on a problem to open that shot and fix it yourself.
- It looks for: a character drawn differently from shot to shot, or a person in a prompt who is not ticked as a character on that shot (their photo would not be sent); shots back to back that would come out the same; anything that invites words, signs or logos in the picture; a prompt that fights the story's style or shape; real people or political symbols.
- **Lyrics (optional):** paste them to also check that each scene fits its words. They are sent once, not stored, and the box empties.
- The button shows the most it can cost (a few cents; more for a long story or with lyrics). That much is held while it runs, and only the real cost counts. It takes about a minute and runs on the same background worker as drafts.
- One check at a time per story. The last check stays on the page; once you edit the storyboard it says **"You have changed the storyboard since this check"** — check again when you are ready. A check not finished after 15 minutes is marked failed and its hold released.

### 2b-bis. Video from your pictures
Instead of a draft (or beside one), **Video from your pictures** builds the story from your own pictures.
- **Add pictures** takes several JPEG or PNG files at once; each becomes a shot, in order (a new story gets a scene called "Your pictures"). Free.
- Each row: the picture, its **seconds** (1-15), and **Still** (a slow zoom in the render, free) or **Moving** (Grok animates it starting from your picture, $0.14–$0.25 a second). A moving row has **How it moves**, a short prompt (pre-filled: gentle, natural movement, keep the picture as it is).
- **Total N s of M s** must match the story's length; **Fit to M s** scales the rows (1-15 s each). Your own clips and clips already made keep their length, because stretching a made clip freezes its last frame and shrinking it cuts it.
- Changing the seconds of a row whose clip is made (clips made from 2026-11-13 on record their length) marks the clip out of date: the row says *Its clip was made for 8 s…*, and **Make the video** makes it again at the new length, priced, unless you set the seconds back.
- **Stop** shows for the whole of **Make the video**. While clips are being made it lets them finish (they are already paid for) and starts no more; nothing renders. Keep the page open: leaving it also starts no more clips and does not render, though clips already started still finish.
- **Make the video (N moving · $X)** confirms with the story total, then: makes a clip for each moving picture that has none yet (one at a time; a clip already made is not paid again), waits for them, chooses each clip for its shot and each still picture for a still shot, and starts **Render video**. A failed clip, a row with no picture, or a total that does not fit stops it before the render, and says why.
- Each moving picture is pinned as its shot's first frame before its clip is made, so a later re-make (from the shot card) still starts from it. A clip already rendering is waited for and used, not paid again. **Remove** deletes a row (e.g. one whose upload failed). It asks first, and says what goes with the row: its pictures and any clips made for it. Paid clips cannot be brought back; making them again costs again.
- **Continue from picture N's clip** (a moving row right after a moving row): its clip starts from the last frame of the clip before it, so the motion runs on across the cut. The browser grabs that frame from the finished clip, uploads it to the row (it shows as **Yours**) and pins it as the first frame. Such a row needs no picture of its own ("Starts where picture N ends."). Chained rows are made one after another, after the clip they follow, so a long chain takes a few minutes per row; the other rows are made together. The row remembers which clip its frame came from: if that clip is re-made, the row says "Will be made again…" and its clip is re-made (and priced) on the next **Make the video**; a re-run after a refusal reuses the frame already copied. On iPhone/Safari the clip is played for a moment before the frame is copied, and a frame that comes out black is refused rather than paid for.
- A video too long for the render worker (stills cost more render time than clips) is refused before anything is paid.
- The panel shows only for a story built from pictures (every shot in a "Your pictures" scene) or an empty one; a drafted story keeps its shot cards.
- Grok makes at most 15 s per clip, so a long video is always several clips joined; the render joins them into one video.
- Known gap: a clip made for 8 s on a row later set to 15 s holds its last frame for the extra 7 s (shorter cuts it); re-make that clip from the shot card.

### 2b-ter. From your own pictures, step by step

The full path for a video made from your own pictures, with the same people in every clip. Worked through on the first real one (a children's folk dance, 2026-11-11). Do the steps in this order.

1. **Master the song first.** A story starts from a **saved master**: Sound Engineering → master the song → save it. Then **Visual Story → New from master**. Choose the part of the song: for a full-song video, choose the **whole song**, because a story's part of the song **cannot be changed** later. Choose the shape (16:9 or 9:16). Set the **budget**: clips are about $1.20 per 15 s as the studio counts them, so allow about $1.30 for every 15 s of moving video.
2. **Set the Style.** Under the title, **Style: none set** → **Set style** → paste one line that describes the look of your pictures (light, colours, place, mood; under 300 characters) → **Save style**. Typing alone does not save it: the top line must read "Style: …".
3. **Add the people, before the pictures.** Open the **Characters** tab → add each person (for example "Dance teacher") with a short description of their hair, jewellery and clothes. Leave out a clothing colour that changes between pictures. Then use the **photo button on that person's card** to add 1–4 face photos. Do not use **Add pictures** for face photos: that makes a picture row, not a face photo.
   - **A good face photo:** square, about **1024 × 1024** (768–2048 works), JPG or PNG under 10 MB; head and shoulders, face about half the picture; even light; plain or blurred background with **no other people**; the same hair and jewellery as in the pictures. Close crops from your own pictures work well.
4. **Add your pictures.** In **Video from your pictures**, **Add pictures**. Use the story's shape: **1920 × 1080** for 16:9 (a square picture loses its top and bottom). **Order matters**: rows play top to bottom, and there is no reorder yet; to move a picture to the end, **Remove** it and add it again. ⚠️ Removing a row also deletes the clip made for it, so move pictures **before** you make the video. Keep each person's **clothes the same** from picture to picture, or group pictures by outfit so it changes only once.
5. **Set every row.** **Moving**, **15 s** (Grok's most per clip), and its own **How it moves** prompt. Paste the prompt, check that the new text shows, then **click outside the box**: that is what saves it. Writing the prompt:
   - describe the **pose already in that picture** and how it moves on from there, plus a slow camera move;
   - end with: "Keep all faces, clothing and background exactly as in the picture. No singing, no lip-sync, no talking, no text, no scene changes.";
   - leave out the shape ("16:9") and place names that fight the picture;
   - **avoid fast spins**: a spin is where Grok most often redraws clothes (a maroon half-saree turned green halfway through one).
6. **Tick who is in each picture.** Each Moving row shows **In this picture:** with a tick per person. **Put everyone in every moving picture (N to update)** ticks them all at once; it appears only while some Moving row is missing someone, so set rows to Moving first. Their face photos then go to Grok with the picture, and the clip is made at **720p**.
7. **"Continue from picture N's clip": usually leave it off.** A ticked row starts from the **last frame of the clip before it** and **ignores its own picture**. Use it only for a row with no picture of its own, to carry straight on from the clip before. With your own picture on every row, leave it unticked on every row.
8. **The total must match the song.** **Total N s of M s** must read the same number twice, or **Make the video** stays greyed out. **Fit to M s** cannot help when there are too few rows (15 s each at most): add rows instead. Example: 60 s = 4 rows of 15 s; 171 s = 11 rows of 15 s + one of 6 s.
9. **Make the video.** Press **Make the video (N moving · $X)** **once** and confirm. Keep the page open. The clips are made together (about 2–3 minutes for four), then the render joins them with the song (about 2 minutes for a minute of video). The finished video plays in **Render video** with **Download video**.
10. **Check the clips.** Play each clip. Re-make one that went wrong from its shot (it costs again). The render is free, so re-render after any change.

**A video longer than one story.** A story's part of the song is fixed. To extend it, make a **new story** over the longer part (for example the whole song), add the first story's **downloaded finished video as your own clip** (free; your own clips can be up to 60 s, MP4 under 200 MB), then add pictures for the rest.

**What it really costs (2026-11-11).** xAI's own usage figures: a 15 s clip with face photos at 720p is about **$2.13**, and a 15 s clip from a picture alone at 1080p is about **$3.76**. The studio counts **$1.20** for both, so its prices and budget totals are about 2–3× low until the rate card is corrected; check the xAI console.

**If the render says "The render failed. Please try again."** The first real render failed when saving the finished video ("socket hang up"). Fixed 2026-11-11 (#441, worker deployed): the save now retries on a dropped connection. Press **Try again**; the clips are reused, so it costs nothing.

### 2c. Every shot at once
Below the check, **Every shot** has two buttons; each shows how many shots and the total, and confirms with the story total first.
- **Pictures for every shot** makes one picture ($0.02) for each shot that has none. The first picture of a shot is chosen for it.
- **Videos for every shot** makes a clip ($0.14–$0.25 a second) for each shot that has a chosen picture, no clip and none rendering; a shot with no picture is left out and counted ("N shots need a picture before their clips"). Each clip starts from that picture (a chosen still is set as the first frame first). You see the clips only after they are made, so try one or two by hand first.
- One shot at a time through the same routes as the shot cards, so the budget cap holds. Over the cap it stops and offers **Raise budget**; a shot that fails is named and the rest go on; **Stop** finishes the current shot and starts no more; once every clip has started there is nothing to stop, so it is hidden while they render. Clips already started keep rendering after Stop or leaving the page — open their scenes to see them.

### 3. Edit
What the studio lets you change by hand today:
- **Scenes:** add a scene (heading) in the left rail; **Delete scene** removes it with all its shots and their stills, after a confirm.
- **Shots:** add a shot to the selected scene; **Edit** a shot to change what it should show, its length (**1–15 s**), its negative prompt and which characters appear; **Delete shot** (in the shot panel) removes it and its stills, after a confirm.
- **Characters:** add a character (name and description) and add or remove its reference photos.
- **Keeping faces in Video from your pictures:** add the people (e.g. the husband and the wife) in the Characters tab, each with 1–4 clear face photos — close crops from your own pictures work well. Every new picture row then includes them; each **Moving** row shows **In this picture:** with a tick per person (a person with no photos is marked "no photos yet"). Untick anyone who is not in that picture, or Grok may add them. Pictures added before the characters existed start with nobody ticked: **Put everyone in every moving picture** ticks them all in one go. Their photos go to Grok with the picture, so the faces stay the same from clip to clip (tested 2026-11-10: from the picture alone the man lost his moustache and face within 5 s; with the photos he kept both for 15 s). Such a clip is made at **720p** (Grok's limit with reference photos); a row with nobody ticked is made at 1080p.
- **Story:** **Rename** (beside the title) changes the story's title. **Delete story** removes the story with all its shots, pictures and clips, after a confirm; money already spent is not refunded. It is refused while a draft or a clip is still being made ("Wait for the draft to finish first.", "Wait for the video to finish first.").

Not available yet: there is **no reorder** of scenes or shots, **scenes cannot be renamed** after they are added, and **characters cannot be edited or deleted** once created. Delete and re-add instead (or apply a new draft).

The bottom bar shows how much of the window the shots fill. They must fill it **exactly** before the later rendering step. It also has the **Budget** field (see below). On a phone, **Edit** takes you down to the shot panel, and the bottom bar sits at the end of the page with a one-line summary (spent, seconds filled, shots chosen) pinned to the bottom of the screen.

Character reference photos are **sent to Grok with a shot's video clip** (made at 720p) so characters look the same from clip to clip; they **do not yet influence still pictures**. They are private (kept in the media bucket, never publicly linked). A still uses the shot's text and the names and descriptions of the characters in it. The **negative prompt is not used yet**, by stills or clips.

### 4. Stills
Press **Generate still ($0.02)** on a shot. You see the price and the story total after it, and confirm. Each confirm adds one candidate picture to that shot. A shot's first picture is chosen for you; tap another picture to choose it instead. Errors (budget reached, content refused, Grok busy) appear beside the button you pressed.

### 5. Video clips
Press **Make video (6 s · $0.48)** on a shot (the label shows that shot's length and price). You see the price and the story total after it, and confirm. The button then reads "Rendering…" and the card says **"Rendering… about 1–3 minutes"**; the clip appears on the shot when it is ready.
- **Cancel** (beside the progress line) asks first and warns **"Grok may still charge for this clip, and it won't be kept."** Pressing **Cancel video** counts the clip's price as spent, because Grok may already have accepted it; **Keep rendering** goes back.
- **Check again** appears if the card stopped watching a clip (for example after a network hiccup). Press it to look once more. If you left the page, press **Check rendering videos (N)** on the story list; N is how many clips are still rendering.
- **No singing:** every clip request ends with "No one in the scene sings, speaks or moves their lips…". Grok cannot sync mouths to the song, so a singing face is always out of time. It is an instruction, not a guarantee: a clip that still shows singing can be re-made.
- **First frame:** a clip starts from the shot's **chosen picture** when that is a still or your upload. **Use as first frame** on another still starts it from that one instead; the shot panel shows **First frame** with the picture and a **Clear** button to go back to the chosen picture. A clip that starts from a picture also sends the photos of the characters in the shot (so their faces hold while they move; xAI accepts both together, tested 2026-11-10) and is then made at 720p; with no characters in the shot it sends the picture alone, at 1080p. With no chosen still, the characters' photos are sent alone, at 720p.
- **Upload picture:** adds your own JPEG or PNG (up to 10 MB, e.g. a thumbnail) to a shot for free. It shows as **Yours** next to the stills and can be picked or used as the first frame. Use a picture already in the story's shape (crop a 16:9 thumbnail to 9:16 for a vertical story), and one without text: a title on it will likely warp once it moves.
- **Character photos** of the characters in a shot are sent to Grok too. A clip that uses them is made at **720p** (without photos it is 1080p).
- **Clip quality** (under Style): **1080p** (sharpest, $0.25/s) or **720p** (cheaper, $0.14/s) for every clip. A clip with faces ticked is 720p either way. Clips already made keep theirs; every price in the studio follows the setting.
- A video **can't be made for a shot without a prompt** ("Write a visual prompt first.").
- **One video per shot at a time** ("A video is already rendering for this shot."). Other shots can render at the same time.
- While any clip is rendering you can't delete or reorder shots, delete scenes, apply a draft, or delete the story. You see "Wait for the video to finish first." Wait, or cancel the clip.
- A clip that has not finished after **1 hour** is ended and its price is counted as spent.
- Clips are private; they are previewed through the admin only.

**Before your first clip:** raise the story's **budget** in the bottom bar. Stories made earlier may have only $1, and a clip over the budget is refused. Each shot card shows what a clip of that shot costs, priced by `clipPriceUsd` from exactly what will be sent: $0.25/s at 1080p (no faces), $0.14/s at 720p (faces ticked), + $0.01 per image, seconds rounded up. When a picture or clip would go over the budget, its message has a **Raise budget** button that takes you to the **Budget** field.

### 6. Render the video
The **Render video** panel under the title joins every shot's chosen picture or clip, in order, with the song's part the story covers, into one MP4.
- It needs **every shot to have a picture or clip chosen** and the shots to **add up exactly** to the story's length. The panel says what is missing ("1 of 12 shots need a picture or clip chosen.", "The shots add up to 2:40 of the song's 3:00.").
- **Pictures get a slow zoom** (alternating in and out); **clips play as made**, without their own sound. A clip a second shorter than its shot holds its last frame; a longer one is cut.
- The panel says how long it takes — a 3-minute mix of clips and pictures takes about 4–5 minutes — and you can keep working meanwhile. Reopening the story picks the progress up again.
- The song fades in and out only where the story starts or ends **inside** the song; a story covering the whole song keeps its own start and ending.
- When it's done the video plays in the panel, with **Download video**. A new render replaces what the panel shows; earlier files stay in storage.
- A render that would take too long for the worker is refused before it starts, with what to change: fewer, longer shots, or clips in place of some pictures (a picture takes longer to render than a clip).
- One render at a time per story ("A render is already running for this story."), and the story can't be deleted while it runs ("Wait for the video render to finish first.").
- If a shot's file can't be used, the message names it, for example "Scene 2, shot 3: the clip could not be read."
- Rendering costs nothing from the story's budget: it runs on our own worker.

### 6b. Or play the clips under the whole song, in Mastering
The story's render covers the story's window. To play its clips under a **whole song** (and get the song's video, short and whole-song vertical from the Mastering pipeline), open the song in **Mastering** and use **Add clips from a visual story** in the background field: the story's clips are added in story order, up to 20, without downloading anything. They play one after another and repeat from the first if the song is longer. See *A video background → Several clips* in the admin docs. Each clip is prepared on `tamilagaval-background-prep` (one-time setup: `scripts/setup-background-prep.sh`).

## Costs and limits

| Item | Price |
|---|---|
| Claude storyboard draft | a few cents (the button shows a ≈$0.15 planning figure) |
| Claude storyboard check | a few cents (the button shows the most it can cost) |
| Grok still picture | $0.02 each |
| Video clip | $0.25/s at 1080p, $0.14/s at 720p (faces ticked, or Clip quality set to 720p), + $0.01 per image sent; seconds rounded up (6 s, 2 faces + picture = $0.87). Settled at xAI's own `cost_in_usd_ticks` when it reports one. |

- **Hard budget per story**, default $40. Change it with the **Budget** field in the bottom bar. The server refuses any generation that would exceed it. A budget of **0** freezes the story. You cannot set it lower than what is already spent or held for a running request; that refusal shows next to the field.
- A picture the content filter **refused is still charged** ($0.02 — xAI bills it) and counts toward the story total. A picture that fails for any other reason (Grok busy, timeout, not configured) is not charged.
- A draft that fails before Claude answers is not charged; one whose answer was unusable is charged for the tokens used.
- A rate limit (20 requests a minute) applies to the studio's actions.
- A clip is charged when Grok finishes it, including one its content filter refused. A clip that fails or expires is not charged, and a clear refusal is not charged; if Grok doesn't answer in time, the clip's cost is counted because Grok may still make it. A cancelled clip is **always counted**, and so is one still unfinished after an hour or one that finished but could not be saved after 10 tries.
- A 30 s Short costs about **$4.20–7.50 for one full pass** (30 s × $0.14–0.25); every retry costs again.
- A 3-minute video is about $25–45 if every shot is a clip, about $13–23 half clips and half pictures, plus retries. Rendering it is free.

## Where files live

Bucket `tamil-web-media`, under `audio/mastering/visual-story/<story id>/`:
- `refs/<character id>/…` — reference photos
- `candidates/<candidate id>.jpg` / `.mp4` — still pictures and clips
- `renders/<render id>.mp4` — finished videos

This area is private (the CDN denies `audio/mastering/*`). Preview through the admin only. The story's records are in the existing `TamilWebContent` table; nothing new was added to AWS.

## The draft runs on the background worker

The Claude draft does not run on the website itself (Amplify stops any request after ~30 s; a draft takes about a minute). The site starts it on the existing worker Lambda **`tamilagaval-compose-worker`** (job kind `storyboard`; the storyboard check is job kind `story-check`) and the panel checks on it every few seconds. That worker must run the same release as the site, with a timeout of at least **720 s** (the draft call itself is allowed 600 s, for a whole song). If the worker is behind, a draft never finishes: once it is 15 minutes old it is marked failed and its hold released the next time the story is opened.

## Rendering runs on the master worker

**Render video** runs on **`tamilagaval-master-worker`** (event `assemble`), the Lambda that already renders the mastering videos. It must be deployed from master **before** anyone renders: an older worker does not know the `assemble` event, and the render then sits "Rendering…" until it is failed as too slow (30 minutes queued, or 16 minutes after it started). The worker writes only the story's render record and the MP4 under `renders/`.

A render is refused if it would take more than about 10 minutes of the worker's 15 (`MAX_ASSEMBLE_SEC`, 600 s): a picture takes about a second of work per second of video, a clip about 0.6. So seven minutes of pictures only is refused; mix in clips, or use longer shots. The limit can rise once a real all-pictures render has been timed on the Lambda.

## Fit to the lyrics (2026-11-13, phase 1)

Design: `docs/superpowers/specs/2026-11-13-fit-to-lyrics-design.md`; plan: `docs/superpowers/plans/2026-11-13-fit-to-lyrics-phase-1.md`.

- **Timing.** `/api/admin/visual-story/[vsId]/lyric-timing` (GET status; POST `start`; POST `align` with the pasted lyrics) runs the same `tamilagaval-lyric-timing` worker as Video Text on the story's `audioKey`. Words are cached at `audio/mastering/lyric-timing/vs/<vsId>/<audio base>.words.json`, so editing the lyrics re-aligns for free. Lines come back in window time (`linesInWindow`). The pasted lyrics are not stored.
- **Fitting.** `fitKeepRows` (`src/lib/visual-story-lyric-fit.ts`) keeps the rows' count and order and moves the cuts: inside singing only on a line start floored to the tenth, inside a music break (a gap of ≥ 4 s) anywhere. Exact dynamic programming on a 0.1 s grid; each row aims at its clip's length.
- **One clip rule.** `clipFitFor` (`src/lib/visual-story-clip-fit.ts`): within a frame is exact; a shorter row trims; a longer row plays the clip slower down to **88 %**; past that, or a trim of a clip the next row continues from, the clip is out of date. A clip with no recorded length (made before 2026-11-13) is never trimmed or slowed on a guess. `scripts/visual-story-clip-lengths.ts` records the real lengths (dry run by default, `--write` to apply).
- **Saving.** `op: 'lengths'` on the shots route writes every row's seconds in one transaction; it is refused (409) unless it names exactly the story's shots and fills the window.
- **Seconds in tenths.** `Shot.durationSec` accepts 0.1 s steps; totals compare to the hundredth (`sameSec`). Grok is asked for `ceil(seconds)`, priced and reserved at that.
- **Render.** Each shot's frames come from the running total (`segmentFrames`), so tenths never drift; a slowed clip carries `playbackRate` (0.88–1) and is re-timed with `setpts` instead of freezing its last frame. Checked on ffmpeg 7.0.2 with `scripts/verify-assemble.ts` (750/750 frames, rows in tenths, a clip at 0.893). Needs the master worker deployed.

## When Grok isn't connected

Symptom: **Generate still** reports that Grok image generation is not configured. Storyboarding, the Claude draft, editing and reference photos still work.

Fix (owner, once): create an API key in the xAI console and store it as a SecureString named `/amplify/d3rkmepk4popv0/master/XAI_API_KEY` in **ca-central-1**. Do not paste the key into chat. The site reads it as its app user `poo-vaasam-app-user`, which needs a one-line read grant on just this parameter (`docs/IAM_LEAST_PRIVILEGE.md` §4).

No rebuild or redeploy is needed; the next **Generate still** picks the key up. If it still says not configured, check the parameter name and that its type is SecureString. To rotate the key, overwrite the same parameter (a running server may keep the old value briefly). If **Generate still** reports an authorisation or billing problem from xAI instead, the key or the xAI account balance is the cause, not the studio.

## Phase 4 exit check (owner and controller, after the first clips)

Make one short test clip. Then compare the xAI console's usage for that day with the stories' **spent** totals (story list). If they agree, the rates are right; record the date in `GROK_RATES_VERIFIED_AT` in `src/services/video/cost.ts`. **Until then it stays `null`** and the prices on screen are unconfirmed. If they differ, fix the rate card first.

No worker or IAM change is needed for clips; the site's app user already reads `XAI_API_KEY`.
