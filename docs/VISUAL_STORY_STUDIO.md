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
- Each row: the picture, its **seconds** (1-15), and **Still** (a slow zoom in the render, free) or **Moving** (Grok animates it starting from your picture, $0.08 a second). A moving row has **How it moves**, a short prompt (pre-filled: gentle, natural movement, keep the picture as it is).
- **Total N s of M s** must match the story's length; **Fit to M s** scales every row (1-15 s each).
- **Make the video (N moving · $X)** confirms with the story total, then: makes a clip for each moving picture that has none yet (one at a time; a clip already made is not paid again), waits for them, chooses each clip for its shot and each still picture for a still shot, and starts **Render video**. A failed clip, a row with no picture, or a total that does not fit stops it before the render, and says why.
- Each moving picture is pinned as its shot's first frame before its clip is made, so a later re-make (from the shot card) still starts from it. A clip already rendering is waited for and used, not paid again. **Remove** deletes a row (e.g. one whose upload failed).
- **Continue from picture N's clip** (a moving row right after a moving row): its clip starts from the last frame of the clip before it, so the motion runs on across the cut. The browser grabs that frame from the finished clip, uploads it to the row (it shows as **Yours**) and pins it as the first frame. Such a row needs no picture of its own ("Starts where picture N ends."). Chained rows are made one after another, after the clip they follow, so a long chain takes a few minutes per row; the other rows are made together. The row remembers which clip its frame came from: if that clip is re-made, the row says "Will be made again…" and its clip is re-made (and priced) on the next **Make the video**; a re-run after a refusal reuses the frame already copied. On iPhone/Safari the clip is played for a moment before the frame is copied, and a frame that comes out black is refused rather than paid for.
- A video too long for the render worker (stills cost more render time than clips) is refused before anything is paid.
- The panel shows only for a story built from pictures (every shot in a "Your pictures" scene) or an empty one; a drafted story keeps its shot cards.
- Grok makes at most 15 s per clip, so a long video is always several clips joined; the render joins them into one video.
- Known gap: a clip made for 8 s on a row later set to 15 s holds its last frame for the extra 7 s (shorter cuts it); re-make that clip from the shot card.

### 2c. Every shot at once
Below the check, **Every shot** has two buttons; each shows how many shots and the total, and confirms with the story total first.
- **Pictures for every shot** makes one picture ($0.02) for each shot that has none. The first picture of a shot is chosen for it.
- **Videos for every shot** makes a clip ($0.08 a second) for each shot that has a chosen picture, no clip and none rendering; a shot with no picture is left out and counted ("N shots need a picture before their clips"). Each clip starts from that picture (a chosen still is set as the first frame first). You see the clips only after they are made, so try one or two by hand first.
- One shot at a time through the same routes as the shot cards, so the budget cap holds. Over the cap it stops and offers **Raise budget**; a shot that fails is named and the rest go on; **Stop** finishes the current shot and starts no more; once every clip has started there is nothing to stop, so it is hidden while they render. Clips already started keep rendering after Stop or leaving the page — open their scenes to see them.

### 3. Edit
What the studio lets you change by hand today:
- **Scenes:** add a scene (heading) in the left rail; **Delete scene** removes it with all its shots and their stills, after a confirm.
- **Shots:** add a shot to the selected scene; **Edit** a shot to change what it should show, its length (**1–15 s**), its negative prompt and which characters appear; **Delete shot** (in the shot panel) removes it and its stills, after a confirm.
- **Characters:** add a character (name and description) and add or remove its reference photos.
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
- **First frame:** a clip starts from the shot's **chosen picture** when that is a still or your upload. **Use as first frame** on another still starts it from that one instead; the shot panel shows **First frame** with the picture and a **Clear** button to go back to the chosen picture. A clip that starts from a picture sends only that picture, not the characters' photos (the picture already shows them; xAI documents the two inputs separately), and is made at 1080p. With no chosen still, the characters' photos are sent instead, at 720p.
- **Upload picture:** adds your own JPEG or PNG (up to 10 MB, e.g. a thumbnail) to a shot for free. It shows as **Yours** next to the stills and can be picked or used as the first frame. Use a picture already in the story's shape (crop a 16:9 thumbnail to 9:16 for a vertical story), and one without text: a title on it will likely warp once it moves.
- **Character photos** of the characters in a shot are sent to Grok too. A clip that uses them is made at **720p** (without photos it is 1080p).
- A video **can't be made for a shot without a prompt** ("Write a visual prompt first.").
- **One video per shot at a time** ("A video is already rendering for this shot."). Other shots can render at the same time.
- While any clip is rendering you can't delete or reorder shots, delete scenes, apply a draft, or delete the story. You see "Wait for the video to finish first." Wait, or cancel the clip.
- A clip that has not finished after **1 hour** is ended and its price is counted as spent.
- Clips are private; they are previewed through the admin only.

**Before your first clip:** raise the story's **budget** in the bottom bar. Stories made earlier may have only $1, and a clip over the budget is refused. Each shot card shows what a clip of that shot costs: every clip is $0.08 a second, whatever the shot's mode. When a picture or clip would go over the budget, its message has a **Raise budget** button that takes you to the **Budget** field.

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

## Costs and limits

| Item | Price |
|---|---|
| Claude storyboard draft | a few cents (the button shows a ≈$0.15 planning figure) |
| Claude storyboard check | a few cents (the button shows the most it can cost) |
| Grok still picture | $0.02 each |
| Video clip | $0.08 per second (6 s = $0.48) |

- **Hard budget per story**, default $40. Change it with the **Budget** field in the bottom bar. The server refuses any generation that would exceed it. A budget of **0** freezes the story. You cannot set it lower than what is already spent or held for a running request; that refusal shows next to the field.
- A picture the content filter **refused is still charged** ($0.02 — xAI bills it) and counts toward the story total. A picture that fails for any other reason (Grok busy, timeout, not configured) is not charged.
- A draft that fails before Claude answers is not charged; one whose answer was unusable is charged for the tokens used.
- A rate limit (20 requests a minute) applies to the studio's actions.
- A clip is charged when Grok finishes it, including one its content filter refused. A clip that fails or expires is not charged, and a clear refusal is not charged; if Grok doesn't answer in time, the clip's cost is counted because Grok may still make it. A cancelled clip is **always counted**, and so is one still unfinished after an hour or one that finished but could not be saved after 10 tries.
- A 30 s Short costs about **$2.40 for one full pass** (30 s × $0.08); every retry costs again.
- A 3-minute video is about $14 if every shot is a clip, about $7–8 half clips and half pictures, plus retries. Rendering it is free.

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

## When Grok isn't connected

Symptom: **Generate still** reports that Grok image generation is not configured. Storyboarding, the Claude draft, editing and reference photos still work.

Fix (owner, once): create an API key in the xAI console and store it as a SecureString named `/amplify/d3rkmepk4popv0/master/XAI_API_KEY` in **ca-central-1**. Do not paste the key into chat. The site reads it as its app user `poo-vaasam-app-user`, which needs a one-line read grant on just this parameter (`docs/IAM_LEAST_PRIVILEGE.md` §4).

No rebuild or redeploy is needed; the next **Generate still** picks the key up. If it still says not configured, check the parameter name and that its type is SecureString. To rotate the key, overwrite the same parameter (a running server may keep the old value briefly). If **Generate still** reports an authorisation or billing problem from xAI instead, the key or the xAI account balance is the cause, not the studio.

## Phase 4 exit check (owner and controller, after the first clips)

Make one short test clip. Then compare the xAI console's usage for that day with the stories' **spent** totals (story list). If they agree, the rates are right; record the date in `GROK_RATES_VERIFIED_AT` in `src/services/video/cost.ts`. **Until then it stays `null`** and the prices on screen are unconfirmed. If they differ, fix the rate card first.

No worker or IAM change is needed for clips; the site's app user already reads `XAI_API_KEY`.
