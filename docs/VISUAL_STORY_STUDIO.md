# Visual Story Studio — operator guide

For the person running the admin. Admin page: **Visual Story** (`/admin/visual-story`). The same text, shorter, is in the admin docs (`/admin/docs`). The engineering design is `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md`.

## What exists today

Phases 2–3: storyboard a music video and make a still picture for each shot. **Not built yet:** video clips (motion / full quality), choosing between clips, and rendering the finished video. Those are later phases.

## Workflow

### 1. Create
**New from master.** Pick a saved master, then the part of the song to film: **30 to 120 seconds**, whole seconds, inside the finished song. Pick **16:9** or **9:16**; this cannot be changed later. Set the story's **budget** (default **$40**).

### 2. Draft
Open the story and use **Draft storyboard**: paste the lyrics and press the button. The draft runs in the background and takes **about a minute** (the panel says "Drafting… this takes about a minute." and the button stays disabled until it finishes). The new draft then appears in the panel with how much of your window it fills; review it, then apply. Applying **replaces** the current storyboard (its scenes, shots and their stills) and asks first. Characters are kept.
- The lyrics are used for that request only and are **not stored**. Paste them again for another draft.
- The button shows **≈$0.15**, a planning figure above what a draft can cost; a real draft costs a few cents (about $0.05–0.06 for a 2-minute window, measured 2026-11-04). While it runs, up to about $0.10 (more for longer lyrics) is held against the budget; only the actual cost counts toward the story total.
- If a draft has not finished after 10 minutes it is marked failed ("The draft took too long. Please try again.") and its hold is released.
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

## Costs and limits

| Item | Price |
|---|---|
| Claude storyboard draft | a few cents (the button shows a ≈$0.15 planning figure) |
| Grok still picture | $0.02 each |
| Motion clip (later phase) | about $0.02 per second |
| Full-quality clip (later phase) | about $0.08 per second |

- **Hard budget per story**, default $40. Change it with the **Budget** field in the bottom bar. The server refuses any generation that would exceed it. A budget of **0** freezes the story. You cannot set it lower than what is already spent or held for a running request; that refusal shows next to the field.
- A picture the content filter **refused is still charged** ($0.02 — xAI bills it) and counts toward the story total. A picture that fails for any other reason (Grok busy, timeout, not configured) is not charged.
- A draft that fails before Claude answers is not charged; one whose answer was unusable is charged for the tokens used.
- A rate limit (20 requests a minute) applies to the studio's actions.
- A whole 2-minute video is expected to cost about $25–35 once video phases exist.

## Where files live

Bucket `tamil-web-media`, under `audio/mastering/visual-story/<story id>/`:
- `refs/<character id>/…` — reference photos
- `candidates/<candidate id>.jpg` — still pictures

This area is private (the CDN denies `audio/mastering/*`). Preview through the admin only. The story's records are in the existing `TamilWebContent` table; nothing new was added to AWS.

## The draft runs on the background worker

The Claude draft does not run on the website itself (Amplify stops any request after ~30 s; a draft takes about a minute). The site starts it on the existing worker Lambda **`tamilagaval-compose-worker`** (job kind `storyboard`) and the panel checks on it every few seconds. That worker must run the same release as the site, with a timeout of at least **180 s** (the draft call itself is allowed 150 s). If the worker is behind, a draft never finishes: after 10 minutes it is marked failed and its hold is released.

## When Grok isn't connected

Symptom: **Generate still** reports that Grok image generation is not configured. Storyboarding, the Claude draft, editing and reference photos still work.

Fix (owner, once): create an API key in the xAI console and store it as a SecureString named `/amplify/d3rkmepk4popv0/master/XAI_API_KEY` in **ca-central-1**. Do not paste the key into chat. No permission change is needed: the Amplify service role's existing `P24SsmSecureStringRead` grant already covers it (`docs/IAM_LEAST_PRIVILEGE.md` §4).

No rebuild or redeploy is needed; the next **Generate still** picks the key up. If it still says not configured, check the parameter name and that its type is SecureString. To rotate the key, overwrite the same parameter (a running server may keep the old value briefly). If **Generate still** reports an authorisation or billing problem from xAI instead, the key or the xAI account balance is the cause, not the studio.
