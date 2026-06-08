# YouTube Channel — Action Plan (You-Driven)

**Companion to:** [`youtube-algorithm-audit.md`](./youtube-algorithm-audit.md) (findings) · [`youtube-tags.md`](./youtube-tags.md) (tag lists)

This file is the **step-by-step playbook**. Code can't fix any of these — YouTube exposes no API for video editing, thumbnail rendering, or algorithm tuning. But every step here is concrete and doable in YouTube Studio / your video editor.

Work top-down: each item is ordered by **impact ÷ effort**.

---

## Week 1 — Quick wins (no video editing needed)

### ☐ STEP 1 — Apply tags to all 9 videos (45 min, biggest single discoverability gain)

**Why:** 0 tags = 4 search views in 28 days. Adding tags will reactivate the YouTube search channel and improve Suggested-videos similarity matching.

**How:**
1. Open `youtube-tags.md` in this folder
2. youtube.com/studio → **Content**
3. For each of the 9 videos:
   a. Click the video → **Edit**
   b. Scroll to **Show more** (below description)
   c. Find the **Tags** field
   d. Copy the comma-separated tag list for that video from `youtube-tags.md`
   e. Paste into the Tags field (Studio auto-splits on commas)
   f. **Save** (top right)
4. ⚠ For video #7 (அன்பெனும் தேரில்): verify the inferred father-theme matches your song before pasting

**Done when:** All 9 videos show 15-20 tags each in Studio.

---

### ☐ STEP 2 — Set a channel trailer for unsubscribed visitors (5 min)

**Why:** First-time visitors to your channel page currently see no featured video. Setting a trailer = automatic "watch this first" experience for new viewers. Direct path to subscriber conversion.

**Pick:** **Anthi Megame** (https://youtu.be/gfywsN483lI). It's your highest-view video and earns the most subs per impression of your discoverable videos.

**How:**
1. youtube.com/studio → **Customisation** (left sidebar) → **Home** tab
2. **Video spotlight** → **For new visitors** → **Add**
3. Paste the Anthi Megame URL or video ID
4. **Publish**

**Done when:** Your channel home page shows Anthi Megame in the featured slot when you view it logged out (open an incognito tab to test).

---

### ☐ STEP 3 — Enable YouTube → Google Analytics tracking (3 min)

**Why:** Wires your YouTube channel into the GA4 property `G-W2GGGP926B` so YouTube events also flow into your `tamilagaval.com` GA4 dashboard. Right now your site GA4 and YouTube analytics are completely separate.

**How:**
1. youtube.com/studio → **Settings** (bottom-left gear) → **Channel** → **Advanced settings**
2. Find **Google Analytics property tracking ID**
3. Paste: `G-W2GGGP926B`
4. **Save**

**Done when:** You see channel views appear under your GA4 property within 48 hours.

---

## Week 2 — The big retention fix (highest leverage on the audit)

### ☐ STEP 4 — Kill the 5–8 second intro on your NEXT upload (most important single change)

**Why:** Every video on your channel loses 13–23% of viewers in a single moment between seconds 5 and 8. That cliff is almost certainly a logo card / fade-in / silence / title screen before the song actually starts. Removing it would lift retention dramatically — and YouTube's recommendation algorithm responds strongly to retention.

Reference: Muthamizhin Moonrezhuthil is the one video on your channel that holds 99% at 5 seconds (others sit at 75–85%). It earned **+3 subs from only 108 views** (2.8% conversion vs 0.5% channel average) — direct proof that better hook = better algorithm response.

**How (on your next upload, before exporting from your video editor):**
1. Open your video project in DaVinci Resolve / Premiere / CapCut / iMovie
2. **Delete any intro card or logo before the song starts.** Cut directly to the music.
3. **Second 0:** Song's chorus melody hits + Tamil title text overlay (white on dark, large enough for mobile = 84% of your audience)
4. **Second 3:** Most quotable lyric line on screen
5. **Second 5:** First clear visual of the lyric-card / poem text layout
6. **No silence anywhere** in the first 8 seconds
7. Re-export, upload as normal

**Done when:** You upload your next video and watch the 5-second retention metric in Studio → Analytics → Engagement → "Audience retention" graph. Goal: hold above 90% at 5s.

---

### ☐ STEP 5 — Cut a Short from Muthamizhin Moonrezhuthil (30 min, hidden-gem amplifier)

**Why:** This video has 3× the retention of everything else but only 108 views because it didn't get velocity in the first 48 hours. Shorts have a SEPARATE impression budget — uploading a Short cut from this video gives the long-form a second chance.

**How:**
1. Watch Muthamizhin (https://youtu.be/J2tc_aUNOPA) and find the **30-second segment with the strongest melodic hook or most quotable lyric**
2. In your video editor, cut a vertical 9:16 (1080×1920) clip of that 30-second segment
3. Add Tamil text overlay matching the lyric (mobile-optimized — large, high-contrast)
4. End the Short on a "Full song link in description ↓" frame at second 29
5. Upload as a Short:
   - Title: A single quotable lyric line
   - Description: starts with "Full song: https://youtu.be/J2tc_aUNOPA" then your tag list for Muthamizhin from `youtube-tags.md`
   - Hashtags in description: #tamilshorts #tamilkavithai #tamilagaval
6. **Set the source video** in the Short metadata → "Linked video" → paste Muthamizhin's URL

**Done when:** Short is uploaded and the linked-source pointer is set. Check 48 hours later — Muthamizhin's view count should start moving.

---

## Week 3-4 — Thumbnail re-renders (moderate effort, compounds gains)

### ☐ STEP 6 — Re-render thumbnails for top 3 videos

**Why:** Thumbnails control CTR (click-through rate) on impressions. Your videos are getting impressions (the algorithm IS pushing them — 77% of traffic from Suggested videos). Improving CTR converts more of those impressions into clicks, which lifts everything downstream.

**Pick:** Anthi Megame, Oru Nal Thirunal, Akkam Pakkam — your top 3 by current views.

**How:**
1. Open Canva (canva.com) → search "YouTube thumbnail" template
2. For each thumbnail, include:
   - **Your face or a strong human emotion** (faces lift CTR ~30% over abstract designs in this genre)
   - **2–4 large Tamil words** from the song's most evocative line — readable at 90×60px mobile thumbnail size
   - **High contrast** — yellow/orange text on dark background works best for Tamil script
   - **No text overlap with title** that appears below the thumbnail in YouTube's UI
3. Export as JPG (under 2MB)
4. youtube.com/studio → **Content** → click the video → **Edit** → **Thumbnail** → **Upload thumbnail**
5. **Save**

**A/B test approach:** Change ONE variable at a time per video so you know what worked. Don't redo all 9 at once.

**Done when:** New thumbnails are live. Check Studio → Analytics → Reach → Impressions click-through rate over the following 14 days. Goal: lift from your current rate (Studio will show you exact number) to ≥4% (genre average for Tamil lyric videos).

---

## Week 4+ — Optional: re-uploads (high effort, last resort)

### ☐ STEP 7 — Consider re-uploading the 3 worst-retention videos with new intros

**Candidates** (videos with retention well below channel average):
- **Enna Mayam** (12.4% avg view %) — currently 328 views, no subs gained
- **Anbenum Theril** (15.2% avg view %) — currently 361 views, +1 sub
- **Oru Nal Thirunal** (16.5% avg view %) — currently 692 views, +2 subs

**Tradeoff:**
- ✅ **Reset on the algorithm's first-48-hour velocity assessment** — videos that didn't get pushed initially can re-enter the algorithm
- ❌ **Lose existing watch history, comments, likes, and accumulated subs from that video**
- ❌ **Search rankings restart from zero**

**Only do this if:** the song quality is genuinely high and you can fix the intro AND the thumbnail AND probably the title. A re-upload with the same problems just loses you data for nothing.

**How (if you proceed):**
1. Re-edit the video applying STEP 4 (no intro card, chorus from second 0)
2. New thumbnail per STEP 6
3. Consider a sharper title — current titles are long Tamil phrases; consider adding a romanised hook ("Enna Mayam — Tamil Love Song · இராஜேஸ்வரன்")
4. Upload as new video, leave the old one published for a week, then make the old one **Private** (NOT delete — preserves any inbound links)
5. After 30 days, evaluate if the new version is meaningfully better. If not, restore the old one to Public.

---

## How to measure progress

After each step, watch these numbers in YouTube Studio:

| Metric | Where | Goal |
|---|---|---|
| **Tags applied** | Content tab → per-video Tags field | All 9 videos show 15-20 tags |
| **Search traffic** | Analytics → Reach → Traffic sources | Search > 50 views/28d (up from 4) |
| **5s retention** | Analytics → Engagement → Audience retention | Hold above 90% at 5s on new uploads |
| **Average view duration** | Analytics → Engagement | Lift from ~60s to 90s+ |
| **Click-through rate (CTR)** | Analytics → Reach → Impressions CTR | Above 4% (Tamil lyric genre average) |
| **Subscribers gained per video** | Analytics → Audience | Each new video gains ≥5 subs in first 7 days |

**Check-in cadence:**
- **7 days after STEP 1 (tags):** has search traffic moved?
- **48 hours after STEP 4 (new upload):** what's the 5s retention number?
- **14 days after STEP 6 (thumbnails):** has CTR lifted?

---

## What's NOT on this list (and why)

- **Run YouTube ads** — premature at 17 subscribers. Ads only convert efficiently once you have proven retention (which we don't yet). Spend the same energy on STEP 4 first.
- **Buy subs / views** — actively harmful. YouTube detects + penalizes, and bot views destroy your retention signal.
- **Post on every social platform** — focus. The current pattern is to upload to YouTube + share to Tamilagaval.com. That's already correct. Adding TikTok/Instagram = 3× content packaging work for ambiguous return.
- **Collab with other channels** — good move eventually, but only after STEP 4 is proven. Otherwise you bring poor-retention traffic into a collab and the partner channel doesn't benefit either.
- **Daily upload cadence** — current ~1 upload per 3-4 days is fine for this genre. Quality > quantity at this stage. Focus on making STEP 4 the new normal for every upload.

---

## TL;DR — if you only do ONE thing this week

**STEP 4. Kill the 5-8 second intro on your next upload.** That single change is worth more than all the other steps combined, because YouTube's algorithm responds most strongly to retention, and your retention drops a cliff in that exact window. Get this right and the algorithm starts rewarding you immediately on the next upload.
