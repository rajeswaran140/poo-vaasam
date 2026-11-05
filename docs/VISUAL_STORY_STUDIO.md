# Visual Story Studio — operator guide

For the person running the admin. Admin page: **Visual Story** (`/admin/visual-story`). The same text, shorter, is in the admin docs (`/admin/docs`). The engineering design is `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md`.

## What exists today

Phases 2–4: storyboard a music video, make a still picture for each shot, and make a **video clip** for each shot. **Not built yet:** joining the clips with the song into the finished video (Phase 6), and a review step for choosing between several clips.

## Workflow

### 1. Create
**New from master.** Pick a saved master, then the part of the song to film: **30 to 120 seconds**, whole seconds, inside the finished song. Pick **16:9** or **9:16**; this cannot be changed later. Set the story's **budget** (default **$40**).

### 2. Draft
Open the story and use **Draft storyboard**: paste the lyrics and press the button. The draft runs in the background and takes **about a minute** (the panel says "Drafting… this takes about a minute." and the button stays disabled until it finishes). The new draft then appears in the panel with how much of your window it fills; review it, then apply. Applying **replaces** the current storyboard (its scenes, shots and their stills) and asks first. Characters are kept.
- The lyrics are used for that request only and are **not stored**. Paste them again for another draft.
- The button shows **≈$0.15**, a planning figure above what a draft can cost; a real draft costs a few cents (about $0.05–0.06 for a 2-minute window, measured 2026-11-04). While it runs, up to about $0.10 (more for longer lyrics) is held against the budget; only the actual cost counts toward the story total.
- If a draft has not finished after 10 minutes it is marked failed ("The draft took too long. Please try again.") and its hold is released — at the latest the next time the story is opened or another draft is started.
- The most recent draft is listed by date when you reopen the story.

### 3. Edit
What the studio lets you change by hand today:
- **Scenes:** add a scene (heading) in the left rail; **Delete scene** removes it with all its shots and their stills, after a confirm.
- **Shots:** add a shot to the selected scene; **Edit** a shot to change what it should show, its length (**1–15 s**), its negative prompt and which characters appear; **Delete shot** (in the shot panel) removes it and its stills, after a confirm.
- **Characters:** add a character (name and description) and add or remove its reference photos.

Not available yet: there is **no reorder** of scenes or shots, **scenes cannot be renamed** after they are added, and **characters cannot be edited or deleted** once created. Delete and re-add instead (or apply a new draft).

The bottom bar shows how much of the window the shots fill. They must fill it **exactly** before the later rendering step. It also has the **Budget** field (see below).

Character reference photos are **stored for the later video phases and do not yet influence still pictures**. They are private (kept in the media bucket, never publicly linked). A still uses the shot's text and the names and descriptions of the characters in it. The **negative prompt is not used for stills yet** either.

### 4. Stills
Press **Generate still ($0.02)** on a shot. You see the price and the story total after it, and confirm. Each confirm adds one candidate picture to that shot; choose the one to use. Errors (budget reached, content refused, Grok busy) appear beside the button you pressed.

### 5. Video clips
Press **Make video (6 s · $0.48)** on a shot (the label shows that shot's length and price). You see the price and the story total after it, and confirm. The button then reads "Rendering…" and the card says **"Rendering… about 1–3 minutes"**; the clip appears on the shot when it is ready.
- **Cancel** (beside the progress line) asks first and warns **"Grok may still charge for this clip."** Pressing **Cancel video** counts the clip's price as spent, because Grok may already have accepted it; **Keep rendering** goes back.
- **Check again** appears if the card stopped watching a clip (for example after a network hiccup). Press it to look once more. If you left the page, press **Check rendering videos (N)** on the story list; N is how many clips are still rendering.
- **First frame:** on a still, **Use as first frame** makes the video start from that picture. The shot panel shows **First frame** with the picture and a **Clear** button to go back to no first frame.
- **Character photos** of the characters in a shot are sent to Grok too. A clip that uses them is made at **720p** (without photos it is 1080p).
- A video **can't be made for a shot without a prompt** ("Write a visual prompt first.").
- **One video per shot at a time** ("A video is already rendering for this shot."). Other shots can render at the same time.
- While any clip is rendering you can't delete or reorder shots, delete scenes, apply a draft, or delete the story. You see "Wait for the video to finish first." Wait, or cancel the clip.
- A clip that has not finished after **1 hour** is ended and its price is counted as spent.
- Clips are private; they are previewed through the admin only.

**Before your first clip:** raise the story's **budget** in the bottom bar. Stories made earlier may have only $1, and a clip over the budget is refused.

**What's next:** laying the clips over the song and rendering the finished video is Phase 6.

## Costs and limits

| Item | Price |
|---|---|
| Claude storyboard draft | a few cents (the button shows a ≈$0.15 planning figure) |
| Grok still picture | $0.02 each |
| Video clip | $0.08 per second (6 s = $0.48) |

- **Hard budget per story**, default $40. Change it with the **Budget** field in the bottom bar. The server refuses any generation that would exceed it. A budget of **0** freezes the story. You cannot set it lower than what is already spent or held for a running request; that refusal shows next to the field.
- A picture the content filter **refused is still charged** ($0.02 — xAI bills it) and counts toward the story total. A picture that fails for any other reason (Grok busy, timeout, not configured) is not charged.
- A draft that fails before Claude answers is not charged; one whose answer was unusable is charged for the tokens used.
- A rate limit (20 requests a minute) applies to the studio's actions.
- A clip is charged when Grok finishes it, including one its content filter refused. A clip that fails or expires is not charged, and a clear refusal is not charged; if Grok doesn't answer in time, the clip's cost is counted because Grok may still make it. A cancelled clip is **always counted**, and so is one still unfinished after an hour or one that finished but could not be saved after 10 tries.
- A 30 s Short costs about **$2.40 for one full pass** (30 s × $0.08); every retry costs again.
- A whole 2-minute video is expected to cost about $25–35 once video phases exist.

## Where files live

Bucket `tamil-web-media`, under `audio/mastering/visual-story/<story id>/`:
- `refs/<character id>/…` — reference photos
- `candidates/<candidate id>.jpg` — still pictures

This area is private (the CDN denies `audio/mastering/*`). Preview through the admin only. The story's records are in the existing `TamilWebContent` table; nothing new was added to AWS.

## The draft runs on the background worker

The Claude draft does not run on the website itself (Amplify stops any request after ~30 s; a draft takes about a minute). The site starts it on the existing worker Lambda **`tamilagaval-compose-worker`** (job kind `storyboard`) and the panel checks on it every few seconds. That worker must run the same release as the site, with a timeout of at least **180 s** (the draft call itself is allowed 150 s). If the worker is behind, a draft never finishes: once it is 10 minutes old it is marked failed and its hold released the next time the story is opened.

## When Grok isn't connected

Symptom: **Generate still** reports that Grok image generation is not configured. Storyboarding, the Claude draft, editing and reference photos still work.

Fix (owner, once): create an API key in the xAI console and store it as a SecureString named `/amplify/d3rkmepk4popv0/master/XAI_API_KEY` in **ca-central-1**. Do not paste the key into chat. The site reads it as its app user `poo-vaasam-app-user`, which needs a one-line read grant on just this parameter (`docs/IAM_LEAST_PRIVILEGE.md` §4).

No rebuild or redeploy is needed; the next **Generate still** picks the key up. If it still says not configured, check the parameter name and that its type is SecureString. To rotate the key, overwrite the same parameter (a running server may keep the old value briefly). If **Generate still** reports an authorisation or billing problem from xAI instead, the key or the xAI account balance is the cause, not the studio.

## Phase 4 exit check (owner and controller, after the first clips)

Make one short test clip. Then compare the xAI console's usage for that day with the stories' **spent** totals (story list). If they agree, the rates are right; record the date in `GROK_RATES_VERIFIED_AT` in `src/services/video/cost.ts`. **Until then it stays `null`** and the prices on screen are unconfirmed. If they differ, fix the rate card first.

No worker or IAM change is needed for clips; the site's app user already reads `XAI_API_KEY`.
