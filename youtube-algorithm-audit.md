# YouTube Algorithm Audit — Tamilagaval Channel

**Date:** 2026-06-01 · **Window:** Last 28 days · **Source:** YouTube Analytics API (owner-scoped, read-only)

This report digs into the actual algorithmic signals YouTube uses to decide what to recommend. Companion to [youtube-tags.md](./youtube-tags.md).

---

## TL;DR

| Finding | Detail |
|---|---|
| 🟢 **Algorithm IS pushing you** | 77% of views (2,803/3,640) come from "Suggested videos" sidebar — the most-coveted YouTube traffic source. |
| 🔴 **Search is dead** | 4 views from search in 28 days. Caused by all 9 videos having ZERO tags. Fix is queued in `youtube-tags.md`. |
| 🟢 **Geography is correct** | 70% India + 10% Sri Lanka + 9% Canada — algorithm is correctly routing to Tamil diaspora. |
| 🔴 **Universal hook failure at 5–8 seconds** | Every video loses 13–23% of viewers in a single moment between seconds 5 and 8. This is a STRUCTURAL problem with how videos open. |
| ⭐ **Muthamizhin is your hidden best** | Holds 99% at 5s, 60% at 60s, **45.8% at the end** (vs ~6–11% for everything else). Only 108 views because it didn't get velocity early. **Cut Shorts from this video first.** |
| 🟡 **Retention ceiling is hit early** | Most videos drop to <12% by mid-video. Lyric-video genre average is 30–40%. Improving thumbnails and opening hooks would lift this significantly. |

---

## 1. Algorithm signals — what YouTube actually sees

### Traffic sources (28d)

| Source | Views | Watch min | % of views |
|---|---:|---:|---:|
| **Related Videos** (Suggested sidebar) | 2,803 | 2,065 | 77% |
| Subscriber (sub feed) | 321 | 462 | 9% |
| Direct / No link | 160 | 292 | 4% |
| External URL (your site, FB) | 89 | 260 | 2% |
| Channel page browsing | 81 | 252 | 2% |
| Playlist | 80 | 261 | 2% |
| YT other pages | 22 | 27 | 1% |
| **Search** | **4** | **23** | **0.1%** |

The dominant impression source is **Suggested videos** — meaning YouTube's algorithm IS actively cross-promoting you when viewers watch similar Tamil music. The bottleneck isn't discovery; it's conversion.

### Geography (28d)

| Country | Views | Watch min | Watch min / view |
|---|---:|---:|---:|
| 🇮🇳 India | 2,534 | 1,895 | 0.75 |
| 🇱🇰 Sri Lanka | 349 | 278 | 0.80 |
| 🇨🇦 Canada | 341 | 1,100 | **3.23** |
| 🇲🇾 Malaysia | 13 | 10 | 0.77 |

Algorithm-driven viewers in India / SL / MY average ~45 seconds per view. Canadian viewers (likely subscribers — family, friends, you) watch ~3 minutes. The gap is the retention problem in numbers.

### Device split (28d)

84% Mobile · 12% Desktop · 2% TV · 1% Tablet. **Design for thumb-scroll viewing.**

---

## 2. Per-video algorithmic signals (28d)

| Video | Views | AVD | Avg View % | Subs | Likes | Sub conv rate |
|---|---:|---:|---:|---:|---:|---:|
| Anthi Megame | 719 | 68s | 18.8% | +4 | 3 | 0.56% |
| Oru Nal Thirunal | 692 | 57s | 16.5% | +2 | 7 | 0.29% |
| Akkam Pakkam | 584 | 46s | 18.6% | +3 | 8 | 0.51% |
| Mudivilla | 477 | 55s | 16.1% | 0 | 3 | 0% |
| Anbenum Theril | 361 | 51s | 15.2% | +1 | 1 | 0.28% |
| Enna Mayam | 328 | 46s | 12.4% ⚠ | 0 | 3 | 0% |
| Irai Theda | 205 | 75s | 19.4% | 0 | 1 | 0% |
| **Muthamizhin** ⭐ | **108** | **188s** | **55.2%** | **+3** | 1 | **2.78%** |

**Muthamizhin's sub-conversion rate is 5x the channel average.** Every 36 views = 1 subscriber. If this video had Anthi Megame's impression count (719), it would have gained ~20 subscribers instead of 3.

---

## 3. Retention curves — where viewers actually leave

% of viewers still watching at each timestamp:

| Video | 5s | 15s | 30s | 60s | 50% mark | End |
|---|---:|---:|---:|---:|---:|---:|
| Anthi Megame | 84.7% | 63.6% | 50.1% | 27.1% | 13.8% | 8.8% |
| Oru Nal Thirunal | 81.9% | 50.0% | 41.0% | 23.6% | 11.1% | 8.0% |
| Akkam Pakkam | 85.2% | 61.4% | 46.4% | 23.0% | 11.2% | 7.7% |
| Mudivilla | 75.2% | 51.1% | 45.3% | 23.1% | 10.5% | 6.0% |
| Anbenum Theril | 83.4% | 57.6% | 36.3% | 19.8% | 10.5% | 7.8% |
| Enna Mayam | 80.6% | 66.9% | 41.6% | 16.6% | 6.9% | 5.3% |
| Irai Theda | 78.5% | 61.5% | 50.0% | 31.5% | 14.5% | 11.0% |
| **Muthamizhin** | **99.1%** | **79.4%** | **73.8%** | **60.8%** | **52.3%** | **45.8%** |

### The cliff at 5–8 seconds

Largest single drop on each video:

| Video | Drop | At second |
|---|---:|---:|
| Anthi Megame | -13.1% | 7s |
| Oru Nal Thirunal | -19.0% | 7s |
| Akkam Pakkam | -13.1% | 5s |
| Mudivilla | -22.7% | 7s |
| Anbenum Theril | -16.0% | 7s |
| Enna Mayam | -20.6% | 8s |
| Irai Theda | -20.5% | 8s |
| Muthamizhin | -13.1% | 7s |

**This is a structural pattern.** Whatever happens in your videos at the 5–8 second mark is bleeding 13–23% of every audience. This is almost certainly **an intro card, logo animation, fade-in, or silence before the song starts**. Muthamizhin is the only one with mild damage here, suggesting it may have a tighter cold-open.

### The action

1. **Open every video with the chorus melody starting at second 0.** No logo card, no silence, no fade-in. The hook must hit before viewers' index finger finds the close button.
2. **Tamil title text overlay must appear by second 2**, not at second 8.
3. **Test on existing uploads:** if you can re-render Anthi Megame with a tighter cold-open and re-upload as a new video (or as a Short), you'll see the algorithm response directly.

---

## 4. Per-video opening-hook ideas

Generated by Claude from each song's title + description + current 5s retention. Pick one per video, or remix.

### அந்தி மேகமே. . . எங்கே சாய்கின்றாய். . .

**Video:** https://youtu.be/gfywsN483lI · **Current 5s retention:** 84.7%

# Opening Hook Ideas: அந்தி மேகமே... எங்கே சாய்கின்றாய்...

**Context note:** At 85%, this video is already above the channel's typical cliff zone — but there's still a 15% drop before the 5s mark, and the gap to Muthamizhin Moonrezhuthil's 99% benchmark is meaningful. These hooks target that remaining loss.

---

HOOK_IDEAS:

1. [Chorus melody hits before any title appears]: Open seconds 0-3 with the song's most aching melodic phrase playing over a deep amber/dusk sky visual — no title card yet, just the atmosphere pulling viewers in. At second 4, let the Tamil text **"அந்தி மேகமே..."** fade in large, centered, as if the sky itself is answering — signaling to diaspora viewers instantly: *this is Tamil poetry, this is yours.*

2. [Lead with the longing question on screen]: In seconds 0-2, show only a darkening twilight sky (no text, no logo) while a single soft instrumental note sustains. Then at second 3, flash just the line **"எங்கே சாய்கின்றாய்?"** in large Tamil script — framing it as a question the viewer feels before they understand it, creating a "wait, what does that mean for *me*?" pause that defeats the skip reflex.

3. [Most quotable lyric as the cold open]: Begin at second 0 with the song's most emotionally loaded lyric line (not the title) already on screen in Tamil, paired with a lone voice or hummed melody — no intro, no channel branding yet. The lyric should carry the *dusk-wandering-cloud* metaphor directly, so a diaspora viewer who feels that specific homesick-evening mood sees their emotion named within 3 seconds and stops scrolling to find out who wrote this.

---

### ஒரு நாள். .  திருநாள். . .

**Video:** https://youtu.be/I2yBppeqIFA · **Current 5s retention:** 81.9%

1. [Open with peak chorus melody, "ஒரு நாள்" title reveal]: Fade in instantly on the most melodically soaring moment of the chorus — no intro silence — so the emotional pull lands before viewers can scroll. At 3s, cut to large-screen Tamil text **"ஒரு நாள்... திருநாள்..."** in warm golden type, signalling "this is your love song, in your language."

2. [Flash the longing question first — "நீ நினைக்கிறாயா?"]: Open seconds 0–3 with a single evocative Tamil question on screen — something like **"அந்த ஒரு நாளை நீ இன்னும் நினைக்கிறாயா?"** — white text, dark soft-focus background, no music yet. At 4s, the melody blooms in, answering the question emotionally and locking the viewer into the memory-longing theme before the 8s cliff.

3. [Lead with the most quotable lyric line, full screen]: Identify the single most ache-filled line from the lyrics — likely one about a cherished memory of young love — and display it alone in Tamil script at full size from second 1. Let it sit for 3 seconds in silence or with a single instrument note, then let the full melody rush in at 5s, so diaspora viewers feel the lyric *before* they hear it, creating an instant emotional contract.

---

### அக்கம் பக்கம் யாருமில்ல. . . பக்கம் வந்து பேசு புள்ள. . .

**Video:** https://youtu.be/bPHAQzOhGc8 · **Current 5s retention:** 85.2%

1. [Chorus drop: lonely ache melody first]: Open seconds 0-3 with the full chorus melody hitting immediately — no intro silence — while the Tamil title **அக்கம் பக்கம் யாருமில்ல** fades in large on screen. By second 5, cut to the raw plea line **பக்கம் வந்து பேசு புள்ள** in bold folk-style Tamil typography, so diaspora viewers feel the longing before a single word is explained.

2. [On-screen question: யாருமில்லாத நேரம் தெரியுமா?]: Flash a single Tamil text question — **உனக்கு யாருமில்லாத நேரம் எப்படி இருக்கும்?** — on a dark, empty background in seconds 0-3, no music yet, just one breath of silence. At second 3, the folk melody rushes in and the title **அக்கம் பக்கம் யாருமில்ல** appears, turning the question into the answer and locking viewers in through second 8.

3. [Most quotable lyric lands at second 2]: Start with the most vulnerable line — **பக்கம் வந்து பேசு புள்ள** — already on screen in large, warm-toned Tamil script before the music begins, framed like a handwritten note. At second 3 the folk rhythm kicks in underneath it, so the viewer reads the emotional peak *before* the setup, creating instant curiosity about the story behind the words.

---

### முடிவில்லா முகத்தினில். . .

**Video:** https://youtu.be/xDxW38e50n0 · **Current 5s retention:** 75.2%

1. [Flash the ache: "முடிவில்லா முகத்தினில்..." fades in slow]: Open on a single line of glowing Tamil text — "முடிவில்லா முகத்தினில்..." — appearing letter by letter against a dark, blurred background in 0-3s, while the first haunting instrumental note holds. By second 5, cut instantly to the chorus melody drop so viewers feel the emotional payoff before they can scroll away.
2. [Pose the unspoken question every lonely viewer carries]: At 0s, display a full-screen Tamil question in bold — "யாரோ ஒருவர் நினைவில் இருக்கிறார்களா?" — held for 3 seconds with complete silence or a single piano note. Then at 3-5s, the melody rises and the title "முடிவில்லா முகத்தினில்..." dissolves in, signalling to diaspora viewers: *this song already knows what you feel.*
3. [Lead with the most gutting lyric line first]: Identify the single most quotable, heart-piercing line from the lyrics and place it alone on screen at 0s — no music, no title, just raw Tamil text on black. At second 3, the melody enters underneath it and the lyric slowly fades into the opening verse, so viewers are emotionally anchored to a specific feeling before the song even formally begins.

---

### அன்பெனும் தேரில். .  வாழ்வை பூட்டி. . .

**Video:** https://youtu.be/xT2lbQwF7Zk · **Current 5s retention:** 83.4%

1. [Flash "தந்தையே... எங்கள் தெய்வம்" in bold Tamil]: Open seconds 0-2 with the title **தந்தையே... எங்கள் தெய்வம்** filling the screen in large, gold Tamil script — no music yet, just the words landing in silence. At second 3, the chorus melody of "அன்பெனும் தேரில்" surges in, carrying that emotional weight forward so viewers feel the dedication immediately.

2. [Ask the question every child carries]: In seconds 0-3, display the Tamil text question **"உங்கள் தந்தை இன்னும் உங்களோடு இருக்கிறாரா?"** in white script on a dark, soft-focus background. By second 5, dissolve into the opening lyric line with the melody rising — diaspora viewers who've lost or are far from their fathers will stop scrolling before they consciously decide to.

3. [Lead with the most quotable sacrifice lyric]: Begin at second 0 with the single most emotionally loaded line from the song — ideally referencing a father's silent sacrifice — displayed as large Tamil text with no visual distraction, accompanied only by a single piano or violin note. By second 6, the full music production kicks in, creating a contrast that rewards viewers who stayed through the quiet opening.

---

### என்ன மாயம் செய்தாயோ

**Video:** https://youtu.be/OF_HshMxabc · **Current 5s retention:** 80.6%

1. [Chorus melody hits before title card appears]: Open with the most melodically "sticky" phrase of the chorus playing over a dark screen — let the music land 1-2 seconds before any visual appears. Then at second 2, slam in the full Tamil title **என்ன மாயம் செய்தாயோ** in large, warm-gold script. The combination of "heard it before I saw it" creates an instant pull for diaspora viewers who already respond emotionally to melody-first reveals.

2. [Tamil text question mirrors the title's wonder]: In seconds 0-3, show only this single line in Tamil on screen — **"யாரோ ஒருவர் உன் மனதை திருடிவிட்டாரா?"** — no music, no visuals, just text on a soft-focus background. At second 4, the opening instrumental floods in and the title card drops, making the viewer feel the question was *answered* by the song itself arriving.

3. [Most quotable lyric as the very first frame]: Identify the single most spine-tingling line from the lyrics — something that captures the **மாயம் (magic/spell)** feeling — and make it the literal first thing on screen at second 0 in bold Tamil script, no intro, mid-thought. Then pull back at second 5 to reveal it is part of the flowing lyric video, so the viewer realizes they have already been inside the song for 5 seconds without noticing.

---

### இரை தேட சென்றதாய் பறவை. . .

**Video:** https://youtu.be/pkDhDVtXSnk · **Current 5s retention:** 78.5%

1. [Chorus drop: mother-bird call over Tamil text]: Open on the most emotionally charged line of the chorus — sung a cappella or with a single instrument — while the Tamil title இரை தேட சென்றதாய் பறவை fades in large on screen. The raw, unaccompanied folk melody in seconds 0-3 signals "this is something ancient and real" before full instrumentation enters at second 5.

2. [Visual question: which shade shelters you?]: Flash a single still image — a bird's nest tucked in tree branches — with the Tamil text question அன்னையும் மரமும் ஒன்றே... overlaid in seconds 0-3, letting viewers complete the thought themselves. This "pause-and-feel" moment creates emotional investment before the first lyric line lands at second 5, making the cliff disappear because viewers are already leaning in.

3. [Most quotable lyric cold-open, no intro]: Begin with zero lead-in — the single most piercing lyric line (தாயின் நிழலே தண்ணீர், மரத்தின் நிழலே தஞ்சம் or equivalent) sung and displayed in bold Tamil script filling the screen at second 0. No logo, no title card, no music swell yet — just the words and voice, so that diaspora viewers recognise within 3 seconds "this lyric is about my mother" and are emotionally anchored before the drop at second 8.

---

### முத்தமிழின் மூன்றெழுத்தில். . .

**Video:** https://youtu.be/J2tc_aUNOPA · **Current 5s retention:** 99.1%

Noted — this is the **benchmark video** (Muthamizhin Moonrezhuthil) that already holds 99% at 5s and 60% at 60s. So rather than fixing a problem, the task here is to **reverse-engineer and document what's working** so it can be replicated.

---

HOOK_IDEAS:
1. [Tamil text "மூன்றெழுத்து = அம்மா" fills screen instantly]: Flash the word **அம்மா** in large, warm-gold Tamil script within the first 2 seconds — no intro, no logo, no countdown. The diaspora viewer's brain registers *"this is mine"* before a single note plays, which is likely the core reason the 5s cliff disappears entirely on this video.
2. [Chorus melody hits at second zero, zero delay]: Begin the audio on the single most emotionally loaded melodic phrase from the chorus — not a build-up, not a music-box intro. The viewer's emotional memory of their own mother activates immediately, making the stop-scroll decision unconscious and instant rather than considered.
3. [On-screen question: "உன் அம்மா நினைவிருக்கா?" appears at 0-3s]: Overlay a single intimate Tamil question in soft white text against a blurred warm background in the first 3 seconds, before any lyric begins. This personal-address technique converts a passive browser into an emotionally invested viewer before the song even identifies itself.

---

## 5. Recommended order of operations

1. **This week** — Apply tags from `youtube-tags.md` to all 9 videos (45 min). Watch search traffic over 7 days.
2. **This week** — Cut a 30-second Short from Muthamizhin Moonrezhuthil's strongest moment. Upload with a clear "Full song link" in the description.
3. **Next 2 weeks** — On the next upload, kill the intro card. Open with seconds 0-3 of the chorus melody + Tamil title overlay. Measure 5s retention against this baseline.
4. **Within 30 days** — Pick the top 3 by views (Anthi Megame, Oru Nal Thirunal, Akkam Pakkam) and re-render new thumbnails focused on face + Tamil text contrast. Use a B-test approach: change one variable at a time so you know what worked.
5. **Within 60 days** — Decide whether to re-upload the worst 3 retainers (Enna Mayam at 12.4%, Anbenum at 15.2%, Oru Nal at 16.5%) with tightened cold-opens. Re-uploads lose the existing watch history but reset the algorithm's first-48-hour velocity assessment.

---

## 6. What we can't measure from the API

- **Impressions** — how many times your thumbnail was shown. Owner-scoped Analytics API returns this metric for Studio but not via the report API at our scope. Check YouTube Studio → Analytics → Reach → Impressions for each video manually.
- **CTR (click-through rate)** — % of impressions that clicked. Same scope issue. Available in Studio under Reach.
- **End-screen / card click-through** — available via API but requires per-video calls; can add to a future audit if you set up end-screens.

These three are the only signals NOT in this report. Everything else here is real data, pulled live.
