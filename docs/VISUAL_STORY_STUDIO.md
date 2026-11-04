# Visual Story Studio — operator guide

For the person running the admin. Admin page: **Visual Story** (`/admin/visual-story`). The same text, shorter, is in the admin docs (`/admin/docs`). The engineering design is `docs/superpowers/specs/2026-09-11-visual-story-studio-design.md`.

## What exists today

Phases 2–3: storyboard a music video and make a still picture for each shot. **Not built yet:** video clips (motion / full quality), choosing between clips, and rendering the finished video. Those are later phases.

## Workflow

### 1. Create
**New from master.** Pick a saved master, then the part of the song to film: **30 to 120 seconds**, whole seconds, inside the finished song. Pick **16:9** or **9:16**; this cannot be changed later. Set the story's **budget** (default **$40**).

### 2. Draft
Open the story and use **Draft storyboard**: paste the lyrics, press the button, review the proposal (it shows how much of your window it fills), then apply. Applying **replaces** the current storyboard and asks first.
- The lyrics are used for that request only and are **not stored**. Paste them again for another draft.
- A draft costs a few cents; the cost is shown and counts toward the story total.
- The most recent draft is listed by date when you reopen the story.

### 3. Edit
Everything can be changed by hand: add, rename, remove and reorder scenes and shots; set each shot's length (**1–15 s**) and what it should show; edit characters and choose who appears in which shot. The bottom bar shows how much of the window the shots fill. They must fill it **exactly** before the later rendering step.

Character **reference photos** are private and help keep a character looking the same. They are stored in the media bucket, never publicly linked.

### 4. Stills
Press **STILL** on a shot. You see the price (**$0.02 per picture**) and the story total after it, and confirm. Each press adds one candidate picture to that shot; choose the one to use. Errors (budget reached, content refused, Grok busy) appear beside the button you pressed.

## Costs and limits

| Item | Price |
|---|---|
| Claude storyboard draft | a few cents, shown before and after |
| Grok still picture | $0.02 each |
| Motion clip (later phase) | about $0.02 per second |
| Full-quality clip (later phase) | about $0.08 per second |

- **Hard budget per story**, default $40, editable. The server refuses any generation that would exceed it. A budget of **0** freezes the story. You cannot set it lower than what is already spent.
- A failed generation is not charged to the story.
- A rate limit (20 requests a minute) applies to the studio's actions.
- A whole 2-minute video is expected to cost about $25–35 once video phases exist.

## Where files live

Bucket `tamil-web-media`, under `audio/mastering/visual-story/<story id>/`:
- `refs/<character id>/…` — reference photos
- `candidates/<candidate id>.jpg` — still pictures

This area is private (the CDN denies `audio/mastering/*`). Preview through the admin only. The story's records are in the existing `TamilWebContent` table; nothing new was added to AWS.

## When Grok isn't connected

Symptom: pressing STILL reports that Grok image generation is not configured. Storyboarding, the Claude draft, editing and reference photos still work.

Fix (owner, once): create an API key in the xAI console and store it as a SecureString named `/amplify/d3rkmepk4popv0/master/XAI_API_KEY` in **ca-central-1**. Do not paste the key into chat. No permission change is needed: the Amplify service role's existing `P24SsmSecureStringRead` grant already covers it (`docs/IAM_LEAST_PRIVILEGE.md` §4).

No rebuild or redeploy is needed; the next STILL press picks the key up. If it still says not configured, check the parameter name and that its type is SecureString. To rotate the key, overwrite the same parameter (a running server may keep the old value briefly). If STILL reports an authorisation or billing problem from xAI instead, the key or the xAI account balance is the cause, not the studio.
