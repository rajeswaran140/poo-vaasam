/**
 * In-app admin documentation registry. Plain markdown strings rendered by the
 * /admin/docs viewer (parsed via src/lib/markdown-blocks.ts — no runtime DB, no
 * external dep). Add a new guide here and it appears in the portal. Keep
 * `updatedAt` current when you edit a doc.
 */

export interface AdminDoc {
  slug: string;
  title: string;
  category: string;
  updatedAt: string; // YYYY-MM-DD
  body: string;
}

export const ADMIN_DOCS: AdminDoc[] = [
  {
    slug: 'prompt-preflight-testing',
    title: 'Tamilagaval Pre-flight — How to test',
    category: 'Composer',
    updatedAt: '2026-06-22',
    body: `# Testing the Tamilagaval pre-flight

The Tamilagaval pre-flight vets a style prompt + lyrics **before** you spend a generation credit. It lives inside the composer, so you test it by composing.

## Setup
1. Open **Music Director** in the sidebar (\`/admin/compose\`).
2. If you were logged in from a previous day, log out and back in once for a fresh token.
3. The AI-critic key is configured in production, so both layers work.

## Test 1 — Happy path
1. Paste clean **Tamil lyrics with section tags** (e.g. \`[பல்லவி]\` / \`[சரணம்]\` or \`[Verse]\` / \`[Chorus]\`).
2. **Compose** (button, or Cmd/Ctrl+Enter) and wait for the brief.
3. Under each card in **"Tamilagaval prompts"** you should see a readiness panel: a **Ready** badge + a **score /100** + any findings with fixes.

## Test 2 — Make the linter fire
The linter checks your pasted lyrics + the generated style prompt. Paste these and re-compose:

| Paste this | Expected finding |
|---|---|
| Plain lyrics with no section tags | "No section tags…" |
| A line with an emoji (❤️) | "Lyrics contain emoji…" |
| Tamil + full English sentences mixed | "mix Tamil with substantial English…" |
| A very long lyric (60+ lines) | "may exceed a single render" |

Each finding shows a concrete fix after the "—".

## Test 3 — AI critic
1. On any variant, click **AI critic** (the ✨ button).
2. Wait ~5–15s for the live Claude call.
3. You should get a **verdict** (ready / risky / not ready) + a one-line summary + semantic issues with fixes.
4. On any error it shows "⚠️ Critic failed" and never breaks the page.

## What to report
- Does the badge + score render under every variant?
- Do the findings + fixes make sense?
- Does the AI critic return a sensible critique in reasonable time?
- Anything off — layout, dark mode, or a wrong finding.
`,
  },
  {
    slug: 'prompt-preflight-how-it-works',
    title: 'Tamilagaval Pre-flight — How it works',
    category: 'Composer',
    updatedAt: '2026-06-24',
    body: `# How the Tamilagaval pre-flight works

The music generator has no API and every generation costs a credit, so this raises your first-try odds **before** you generate. Two layers:

## 1. Deterministic linter (free, instant)
Runs on every composer result with zero cost. It flags structural credit-wasters:

- **STYLE_TOO_LONG / STYLE_HAS_LYRICS** — style box over the cap, or lyrics leaking into it (the generator sings the style box too).
- **STYLE_GENRE_CONFLICT** — e.g. EDM + carnatic → mush.
- **STYLE_VAGUE** — missing tempo / instrument / vocal / mood cues.
- **LYRICS_NO_STRUCTURE** — no \`[Verse]\` / \`[Chorus]\` tags.
- **LYRICS_TOO_LONG / LYRICS_MANY_LINES** — won't fit one render.
- **LYRICS_MIXED_LANG / LYRICS_EMOJI** — mispronunciation / the generator vocalising emoji.

Each finding carries a **fix**. The badge is **Ready** only when there are no errors.

## 2. AI critic (on demand)
The ✨ button runs a Claude pass for **semantic** risks the linter can't see — style↔lyric mood mismatch, unsingable phrasing, ambiguous direction — and returns a verdict + concrete fixes.

## The workflow it enables
Compose → read the readiness panel → fix the flagged issues (or pick the best-scoring variant) → only then paste into the generator. You spend credits on a **vetted** prompt instead of trial-and-error.

> The **attempt log** is now live — see the **Music Lab** guide. After you generate, log each attempt's outcome there so you learn what works over time.
`,
  },
  {
    slug: 'music-lab-logging-generations',
    title: 'Music Lab — Logging generations',
    category: 'Music Lab',
    updatedAt: '2026-06-24',
    body: `# Music Lab — turn every generation into data

Most people delete the SUNO takes that didn't work. **Music Lab** keeps them. Every attempt — keeper *or* failure — gets logged against its brief with the audio, the settings you used, scores, a verdict, and what went wrong. Over time that becomes a private dataset: which **emotion × raga × voice** combinations actually land, and why the rest don't.

Open **Music Lab** in the sidebar (\`/admin/music-lab\`).

## When to log
Right after a SUNO (or other engine) run comes back. SUNO has no API, so there's no automatic capture — logging is a quick manual step you do per take.

## How to log an attempt
1. **Pick the brief** the take came from (the dropdown lists your saved briefs from Music Director). Don't have one? Compose + **Save brief** first.
2. Fill the **Log a generation** form:
   - **Engine** — suno (or lyria / udio / other).
   - **Style variant** — which of the brief's Tamilagaval prompts you used (pre-filled from the brief).
   - **Audio** — upload the MP3 (or paste an http(s) URL). Optional — you can rate before the file is back.
   - **Settings** — the knobs you used: *weirdness* (0–100), *style influence* (0–100), and a free-text *engine/model* tag (e.g. \`suno v4.5\`).
   - **Scores** — rate **melody / vocals / lyrics / mix** 0–10. Score only what you can judge; blanks are fine.
   - **Verdict** — \`success\`, \`partial\`, or \`failed\`.
   - **Primary issue** — when it's not a success, what mainly broke (vocal delivery, mixing, pronunciation, arrangement…).
   - **Notes** — the most valuable field. Be specific: *"excellent flute intro, weak chorus transition, robotic vocals."*
3. **Log generation.** It appears immediately in the **Attempts** list (newest first) under that brief, with its verdict badge and audio player.

## Two things to know
- **You score the audio, not the AI.** An LLM can't *listen* to an MP3, so melody/vocals/mix are your call. The machine's job (later) is to find patterns across what you logged.
- **Capture first, insights later.** The "this raga + voice succeeds 70% of the time" rollups need volume to be meaningful. Log consistently now so the dataset is there when it's worth analysing.

## What's coming (Phase 2/3)
- **Find similar** + an AI report on *why your failures cluster* (e.g. "vocal_delivery fails when tempo > 130").
- Tagging great moments by timestamp → a reusable **intro / chorus / bridge** library, and reference exports for LYRIA.

> The point isn't any single song — it's that 500 logged attempts become a Tamil-music asset no one else has.
`,
  },
  {
    slug: 'suno-instrument-palette',
    title: 'Instrument palette for SUNO prompts',
    category: 'Composer',
    updatedAt: '2026-06-26',
    body: `# Instrument palette for SUNO prompts (Tamil composition)

A working catalogue of instruments to draw on when writing the **style prompt** for a Tamilagaval song. SUNO responds best to plain **English instrument names + a mood adjective** ("soulful bamboo flute", "driving folk drum"). Pick a small, coherent ensemble per song — usually **one lead + one or two support + a rhythm core + a drone/pad** — and name each with its role.

## How SUNO reads instruments
- **Recognised by name** — use as-is: flute, bamboo flute, violin, cello, sitar, tabla, harmonium, acoustic / nylon / electric guitar, mandolin, piano, strings, saxophone, harp, synth, drums.
- **Describe instead of naming** — SUNO is unreliable on the Carnatic / Tamil term, so give the family + texture:

| You want | Prompt it as |
|---|---|
| Mridangam | "South Indian classical hand drum" / "double-headed tabla-like drum" |
| Nadaswaram | "South Indian double-reed wind, shehnai-like, bright and reedy" |
| Veena | "Indian classical plucked strings, sitar-like with gamaka glides" |
| Thavil | "loud festive folk barrel drum" |
| Ghatam | "clay-pot hand percussion" |
| Kanjira | "small frame drum / tambourine" |
| Parai / Thappu | "driving folk frame drum" |
| Udukai | "hourglass talking drum" |
| Morsing | "jaw-harp twang" |
| Konnakol | "rhythmic vocal percussion (spoken syllables)" |

- Keep it to **2–4 named instruments** — piling on ten muddies the mix. Add a **tempo/BPM** and a one-word **production feel** (organic, cinematic, lo-fi, retro-film).

## By family

**Plucked & bowed strings (melody, warmth)** — Veena (lead/countermelody), Sitar, Carnatic violin (gamaka-heavy, soulful), Cello (sorrow), Acoustic/Nylon guitar (intimate), Carnatic mandolin (bright lead), Santoor (shimmer), Sarangi (vocal-like ache), Tanpura (drone), Harp + lush string section (cinematic).

**Winds (the Tamil melody soul)** — Bamboo/Carnatic flute (love, longing, pastoral — the most-reached-for lead), Nadaswaram (temple, wedding, grandeur), Shehnai, Carnatic saxophone (smooth film), Clarinet, Ney / pan flute (lonely, breathy).

**Percussion (rhythm core)**
- **Classical:** Mridangam, Kanjira, Ghatam, Morsing.
- **Folk / festive:** Thavil (with nadaswaram), Dholak / Dhol, Parai, Thappu / Thappattam, Udukai.
- **Modern:** full drum kit, cajon, congas / bongos, claps, shakers, finger cymbals (jalra), 808 / trap kit for fusion.
- **Vocal:** Konnakol.

**Keys & harmony** — Harmonium (devotional / film), Piano (ballad, cinematic), Rhodes / electric piano (warm modern), Organ, Synth pads & strings (contemporary bed).

**Bass & low end** — Acoustic / electric bass, Synth bass, Sub / 808 (modern fusion).

**Texture & atmosphere** — Tanpura / shruti-box drone, ambient pads, swells, temple bells / chimes, vinyl-crackle lo-fi, reverb-washed plucks.

## Mood → ensemble starting points

| Emotion / style | Suggested palette |
|---|---|
| Romantic melody (காதல்) | bamboo flute lead, veena/violin countermelody, nylon guitar, soft hand-drum + clay-pot, tanpura, string pad |
| Sad / longing | solo Carnatic violin or cello, sparse piano, ney, tanpura, light frame drum |
| Folk / village (கிராமம்) | nadaswaram + thavil, dhol, parai, udukai, shakers, hand claps — earthy, fast |
| Devotional / serene | harmonium, nadaswaram, temple bells, tanpura, gentle mridangam, choir pad |
| Mother / tender (தாய் பாசம்) | piano, nylon guitar, soft strings, bamboo flute, brushed percussion |
| Motivational / uplifting | string section, drum kit, dhol accents, electric guitar, piano, anthemic build |
| Modern indie / film fusion | acoustic guitar + synth pads, 808 bass, lo-fi drums, flute or violin hook over it |

## Writing it into a prompt — example
> South Indian romantic melody, ~80 BPM, female voice. Soulful bamboo flute lead, Indian classical plucked strings (veena-like) countermelody, gentle nylon guitar, soft South-Indian hand-drum and clay-pot percussion, tanpura drone, warm string pad. Organic, cinematic, intimate.

Tie the palette to the brief's **emotion + raga + voice** — the instruments are the colour on top of that structure. Log which palettes land in **Music Lab** so your go-to ensembles become data.
`,
  },
  {
    slug: 'lyric-critic-coach-draft',
    title: 'Lyric Critic — coach your own draft',
    category: 'Composer',
    updatedAt: '2026-06-29',
    body: `# Lyric Critic — coach your own draft

The **Lyric Critic** (\`/admin/compose/critique\`) reads a lyric **you wrote** and gives honest, specific feedback to sharpen it. It is the *augment-your-craft* tool: it **never writes or rewrites** your lyric — it coaches. The words stay yours.

> Not the same as the **✨ AI critic** inside Music Director. That one vets a *SUNO style prompt* before you spend a credit. This one critiques *your Tamil lyric* as a piece of writing.

## When to use it
On a draft you're still shaping — before you take it into Music Director / SUNO. Run a song you know cold first, to calibrate whether its eye is useful to you.

## How to use it
1. Open **Lyric Critic** in the sidebar.
2. Paste **your own draft** into the box (Tamil; section tags like \`பல்லவி\` / \`சரணம்\` help it reason about structure but aren't required).
3. *(Optional)* Tap **focus** chips — meter, imagery, vocabulary, emotion, originality, structure — to weight the read, and add a **note** for anything specific you want looked at.
4. Click **Critique my draft**.
5. **Give it a minute or two.** A full-ballad critique is a deep read that runs in the background (~1–2 min) — the feedback appears when it's ready. Keep the tab open; it polls for you. (It runs off-platform precisely so a long read can't time out.)

## What you get back
- **Overall** — an honest few-sentence read of the draft as a whole.
- **Strengths** — what's already working, and the lines that earn it.
- **Lines that go slack** — specific lines **quoted verbatim** + *why* each weakens the song. Never a replacement line; the fix is yours to make.
- **Word ideas** — alternative Tamil words to *consider* (a thesaurus, not an edit).
- **Questions** — sharp prompts to push your own thinking.

## How to read it (important)
It's a **sparring partner, not a judge** — fluent but fallible:
- Treat confident claims — especially **etymology** or "this is a cliché" — as *"check this,"* not verdicts. You know the language and your own voice better than it does.
- A flagged "emotional plateau" may be an intentional, steady mood — your call.
- The highest-value notes are usually the **meter / repeated-ending** patterns (hard to spot in your own work) and the question *"is there one image that could only belong to this song?"*

## If it errors
On a failure it shows a message and never breaks the page — just try again. A persistent failure usually means the AI key is unset (the page shows an "AI not configured" banner when so).
`,
  },
  {
    slug: 'upload-cadence-timing',
    title: 'Upload cadence & timing — when to publish',
    category: 'Publishing',
    updatedAt: '2026-07-06',
    body: `# When to upload — cadence, best days & times

Data-backed publishing guide for the Tamilagaval channel. Figures are from the trailing 12 weeks (pulled 2026-07-06) — re-check periodically as the audience grows.

## Cadence — 1 song every 3–4 days (~2 per week)
- Growth here is **suggested / related-video driven**, so each new song needs a few days of clean runway for the algorithm to test it and find its audience.
- Two songs within a day or two **compete for the same recommendation slots and split each other's early push** (the 2026-06-22 double-upload lesson).
- **Never 2 in one day**, and avoid back-to-back days for full songs.
- Have a batch ready? Spread them — e.g. 5 songs over ~2.5–3 weeks, not one week.

## Best days
Average daily views by weekday (trailing 12 weeks):

| Wed | Tue | Mon | Sun | Sat | Fri | Thu |
|--:|--:|--:|--:|--:|--:|--:|
| 1,954 | 1,761 | 1,580 | 1,547 | 1,308 | 1,289 | 939 |

- **Publish on Wednesday / Tuesday** (strongest); Sunday and Monday are also good.
- **Avoid Thursday** — clearly the weakest day (~half the views, and worst for new subscribers too).

## Best time
- Audience is **~93% India + Sri Lanka** (both UTC+5:30), so target **IST**, not your local time.
- Publish **~5–7 PM IST** (≈ 11:30–13:30 UTC) — so it is live and gathering early signal just before the 8–10 PM India music-watching peak (YouTube favours publishing ~1–2 hrs ahead of peak).
- Use Studio → **Schedule** to pin the exact IST time even while you are on Canada time.
- The exact hourly heatmap is **Studio-only** (Studio → Audience → "When your viewers are on YouTube") — the API cannot return it; the day + timezone guidance above aligns with it.

## Sequencing a batch
- **Lead with your strongest song** — early algorithmic impressions compound while the channel is in its breakout window.
- **Alternate emotion / style** between consecutive drops (do not put two slow melodies back-to-back) so they pull different audience slices instead of competing.

## During YPP review
- **New, distinct songs are encouraged** — an active channel releasing originals is a positive signal. Keep uploading these on the cadence above.
- **Hold duplicate / alternate-version uploads** (e.g. a folk "Version 2" of an existing song) until after approval, to avoid any near-duplicate concern during the review.

## Related — instrumentals
Per-song instrumental versions currently **underperform** (about 1/6 the views of the vocal, ~24% retention, near-zero search discovery) and do not reach the search-driven relaxing/study audience. Not a per-song priority — if pursued, they need a dedicated playlist + long-compilation lane, not scattered uploads.
`,
  },
  {
    slug: 'reach-eelam-tamil-community',
    title: 'Reach the Eelam Tamil community — distribution kit',
    category: 'Growth',
    updatedAt: '2026-07-06',
    body: `# Reach the Eelam Tamil community

**The opportunity:** ~200,000 Sri Lankan Tamil refugees in Tamil Nadu + ~2 million diaspora worldwide — an audience with a deep emotional need (homeland, மண், memory, belonging) that Tamilagaval's original, quality, *organized* homeland catalogue meets like no other channel. The fit is proven; the gap is **awareness**, i.e. distribution.

**Your biggest advantage:** you live in **Toronto (GTA)** — one of the largest Eelam Tamil communities on earth. You're embedded in a core node of your target audience: a high-trust, in-person + WhatsApp channel. Start there.

**Golden rule:** keep it **cultural, emotional, apolitical** — homeland longing + nature, never politics or liberation framing. That keeps the channel a safe, shareable home for *every* Tamil (and avoids risk in a sensitive space).

## WhatsApp share pack (ready to forward — one warm line + a link)
WhatsApp is the #1 way Eelam Tamil families share music (and it's invisible in view sources, but travels far). Share **one song per week**, never a flood.

- **எங்கள் தேசம்** (names Yaazhpaanam, Kilinochchi, Mullaitivu, Vanni, Batticaloa… — the strongest Eelam song):
  \`🌾 நம் ஈழத்து ஊர்களை நினைவுகூரும் ஒரு அசல் தமிழ்ப் பாடல் — மனதைத் தொடும். கேட்டுப் பாருங்கள்: https://youtu.be/NxgKyBINwmc\`
- **ஈழத்து மண்ணே, காலத்து பொன்னே:**
  \`❤️ "ஈழத்து மண்ணே, காலத்து பொன்னே..." — நம் மண்ணின் மணம் கமழும் அசல் தமிழ்ப் பாடல்: https://youtu.be/tw49AjsZs1E\`
- **என் தேசமே, என் சுவாசமே** (newest homeland song):
  \`🌿 "என் தேசமே, என் சுவாசமே..." — பிறந்த மண்ணின் மீதான நேசத்தை உணர்த்தும் புதிய பாடல்: https://youtu.be/akxtNVXgGf4\`
- **தாயகம் / Heritage collection** (whole homeland catalogue in one place — your organization advantage doing the work):
  \`🌾 தாயகம் பற்றிய தமிழ்ப் பாடல்களின் தொகுப்பு: https://www.youtube.com/playlist?list=PLEXvbEQYvb5A\`
- **Share Your Story** (turn listeners into community):
  \`உங்கள் ஊர், உங்கள் நினைவு — பகிருங்கள். சில கதைகள் அடுத்த பாடலாகலாம்: https://tamilagaval.com/share\`

## Community outreach playbook (over weeks, not days)
1. **Your own circle first** — forward one song (with the warm line) into family/friend WhatsApp groups; ask 3–5 trusted people to pass it on. Highest-trust distribution.
2. **GTA community nodes** — Eelam Tamil associations, temples, cultural orgs, community-event groups. Share the Heritage playlist + one song.
3. **Diaspora Facebook groups** (Eelam / SL-Tamil community groups, worldwide) — post a homeland song with the warm line; homeland/nature content is welcome and shareable.
4. **Tamil Nadu segment** — the ~200k refugees are concentrated in TN settlements; reachable through TN SL-Tamil community organizations + local WhatsApp/FB groups, where word-of-mouth compounds fast once it catches.
5. **Invite the story** — point people to /share for homeland/birthplace memories; feature the best (they become community, and possibly future songs).
6. **Cadence & tone** — one warm share per week per group (don't spam); always cultural/emotional, never political.
7. **Watch it work** — track the Sri Lanka % in YouTube Analytics over the coming weeks (currently ~8% vs ~85% India). A few dozen genuine shares this month → a few hundred next.

**Realistic note:** community word-of-mouth is a marathon, but in a tight, emotionally-connected community it *compounds*.

## Ready-to-use messages

### Community / association group intro (when you're new to a group)
Use once, warmly, to introduce yourself + the channel to a group that doesn't know you yet (temple / association / community WhatsApp or FB group):

\`\`\`
வணக்கம் அன்பர்களே 🙏
நான் இராஜ் — 35 ஆண்டுகளுக்கும் மேலாக தமிழில் கவிதைகளும் பாடல்களும் எழுதிவருகிறேன். நம் தாயகம், நம் மண், நம் நினைவுகள் சார்ந்த அசல் தமிழ்ப் பாடல்களை "தமிழகவல்" YouTube சேனலில் பகிர்ந்து வருகிறேன்.

நம் ஈழத்து உள்ளங்களைத் தொடும் சில பாடல்கள்:
🌾 எங்கள் தேசம்: https://youtu.be/NxgKyBINwmc
🎵 தாயகம் பாடல்கள்: https://www.youtube.com/playlist?list=PLEXvbEQYvb5A

நேரம் கிடைக்கும்போது கேட்டுப் பாருங்கள். பிடித்தால் பகிர்ந்து, சேனலை Subscribe செய்து ஆதரியுங்கள். நன்றி. ❤️
\`\`\`

### Homeland "Share Your Story" prompt (YouTube Community post / pin)
Seed the /share campaign with the exact memory this audience feels most — pin on a homeland song:

\`\`\`
🌾 உங்கள் ஊர், உங்கள் நினைவு...
நீங்கள் பிறந்த ஊர், விளையாடிய வீதி, உங்கள் மண்ணின் வாசம் — இன்று எங்கு வாழ்ந்தாலும் மனதில் நிற்கும் அந்த நினைவை என்னுடன் பகிருங்கள். 👉 tamilagaval.com/share
சில நினைவுகள் என் அடுத்த தாயகப் பாடலாக மலரலாம். ❤️
— இராஜ் | தமிழகவல்
\`\`\`
`,
  },
  {
    slug: 'end-screen-routing',
    title: 'End-screen routing — subscriber conversion',
    category: 'Growth',
    updatedAt: '2026-07-07',
    body: `# End-screen routing for subscriber conversion

**The finding:** the channel converts ~4.1 subs / 1,000 views overall, but **song-level subscriber affinity varies 3–6×** — that is a bigger lever than the subscribe watermark. So route each discovery engine's end screen to a **proven converter within its genre cluster**, not just a thematically-similar song.

**Method:** full songs only (Shorts excluded — their subs attribute differently), 2026-04-01 → today, **min 800 views** for a reliable rate, cluster-aware (route within genre to the best subs/1k).

**Studio note:** the cleanest end screen = **ONE video element + a Subscribe element**. So below, **Target 1 = the primary end-screen video**; **Target 2 = a fallback / manual alternative** (or a playlist card). Every source also gets a **Subscribe** element.

## Routing table — do in priority order
| P | Source (discovery engine) | views | own /1k | Target 1 (primary) | Target 2 (alt) |
|---|---|--:|--:|---|---|
| **1** | எழுதாத வரியிலே · VUIpOkk62fc | 3,640 | **1.37** | காலை காற்றே · DrPPkgumCQw (8.14) | பொன்வானம் சாயுதே · d3puwsvsZdI (5.99) |
| 2 | நீ சிரிச்ச நேரம் · GXLu3Y7FghU | 24,429 | 5.40 | காலை காற்றே (8.14) | பொன்வானம் (5.99) |
| 2 | செவ்வந்தி பூவே · H5NcoS41fA4 | 13,852 | 4.26 | காலை காற்றே (8.14) | மெல்ல மெல்ல · ldgMDPRnHp0 (5.75) |
| 3 | என் மன்னவனே · eo3Mo--sgPY | 8,291 | 4.46 | காலை காற்றே (8.14) | உன்னை பார்த்தால் · lWt5kvapFKs (5.56) |
| 3 | என் பொன்மணி · KtFF0CCnCY4 | 6,622 | 4.68 | காலை காற்றே (8.14) | பொன்வானம் (5.99) |
| 3 | குறிஞ்சி மலரே · BoHXKQCfOqU | 4,320 | 3.47 | காலை காற்றே (8.14) | மெல்ல மெல்ல (5.75) |
| 4 | உன்னை பார்த்தால் · lWt5kvapFKs | 3,057 | 5.56 | காலை காற்றே (8.14) | மெல்ல மெல்ல (5.75) |

**Priority logic:** P1 = எழுதாத வரியிலே — the biggest leak (high reach × worst conversion 1.37/1k), fix FIRST. P2 = highest-reach engines (a small lift on 14–24k views = many subs). P3/P4 = mid / smaller reach.

## Reference — best reliable converters (subs/1k, ≥800 views)
- **love / melody:** காலை காற்றே **8.14** · பொன்வானம் சாயுதே 5.99 · மெல்ல மெல்ல 5.75 · உன்னை பார்த்தால் 5.56 · நீ சிரிச்ச 5.40
- **homeland:** ஈழத்து மண்ணே ♀ (tw49AjsZs1E) 7.27 · ♂ (KpWeuW_l9xc) 6.13 — (எங்கள் தேசம் NxgKyBINwmc 8.42 but only 706 views → a destination to *boost*, not a discovery engine)
- **mother:** அம்மா உந்தன் (CYVbd5a3uQ4) 6.91
- **motivational:** தம்பி நீயும் கலங்காதே (AD5xJe6CTnk) 7.29
- **folk:** கடலோடு பேசுதடி 6.49 · ஆலமர நிழல் கீழே 6.17

## Worst converters — never end-screen TO these
எழுதாத வரியிலே 1.37 · சித்திர செவ்வானம் (TqM4sChi7eQ) 0.00 · விண்ணிலே தேடிய நிலவை 1.43 (small sample) · ஒரு நாள் திருநாள் 2.29 · முடிவில்லா முகத்தினில் 2.97 · அந்தி மேகமே 3.31.

## Already done (API side, 2026-07-07)
- **Love Songs playlist now leads with காலை காற்றே** (best converter, 8.14/1k).
- All 5 discovery engines have Subscribe + playlist links in description + a pinned Subscribe CTA.
- Subscribe watermark set (entire video, all videos).

**Re-pull quarterly** as views accumulate — rates on <800-view songs firm up over time and the routing may shift.

## Conclusion (authoritative framing)
> We have now removed the obvious conversion leaks. The next 14 days test whether better subscription surfaces and cluster-aware routing can raise full-song conversion above the historical **~4.1 subs/1K** baseline. If conversion remains near 4 despite comparable traffic, the bottleneck is no longer subscribe visibility; the next strategic problem is **viewer affinity, channel identity, and returning-audience formation.**

Historical baseline: **731 subscribers from 179,684 views ≈ 4.07 subs/1K.**

## Precision notes (don't overstate the mechanism)
- **Watermark = an *additional* persistent subscribe surface, not the only one.** The watch-page Subscribe button already existed; the watermark adds another. And YouTube video watermarks are **NOT clickable on mobile** — so it is incremental, not a universal "one-tap subscribe."
- **End-screen routing does NOT transfer the destination's rate.** காலை காற்றே's 8.14/1K describes *its own* historical audience mix; viewers referred from நீ சிரிச்ச may convert differently. The experiment specifically tests whether **referred discovery-engine viewers retain higher subscriber affinity** on the converter — it is a hypothesis, not a guaranteed 8.14.
- **Realistic magnitude:** at ~6,857 views/day, lifting 4.07→5.5–6.0 subs/1K ≈ **27.9/day → 37.7–41.1/day (+10–13/day)**; the 276-sub gap (724→1,000) closes in **~9.9 days vs ~6.7–7.3 days ≈ ~3 days saved** (traffic and net-subs fluctuate). Meaningful, not transformative — the conversion stack *harvests existing reach more efficiently*; **content selection + channel identity are the larger long-term levers.**
`,
  },
  {
    slug: 'youtube-credit-block-policy',
    title: 'YouTube credit block — the canonical policy',
    category: 'Publishing',
    updatedAt: '2026-07-08',
    body: `# YouTube credit block — the canonical policy

Every song description uses ONE standard credit block. This keeps the catalogue consistent and keeps our public positioning right: **lead with authorship, be transparent about production, never let the tooling read as the principal creator.**

## The block (use this exactly, every upload)

\`\`\`
✍️ Lyrics: Raj
🎵 Music Production & Creative Direction: TamilAgaval
🤖 AI-Assisted Music Production
\`\`\`

## Never use these phrases in a description
| ❌ Banned | Why | ✅ Instead |
|---|---|---|
| \`Music composition: AI-assisted\` | Makes the tool sound like the principal creative identity | \`AI-Assisted Music Production\` (Raj's lyrics + musical direction + prompt/version/vocal/style decisions = TamilAgaval's creative direction) |
| \`100% original\` | AI-assisted-work copyright is jurisdiction-specific and fact-dependent (Canada policy still evolving) — don't make a legal-sounding claim in marketing copy | Just \`✍️ Lyrics: Raj\` |
| Full legal name in the body | Keep the public credit short and brand-owned | \`Raj\` |

Never name a specific AI tool (SUNO, Lyria, etc.) — anywhere, public or in records. The music belongs to Tamilagaval.

## How it's enforced (you don't hand-type it)
The composer's **"📋 Copy ready-to-paste"** button (\`/admin/compose\`) now bakes the block in automatically:
1. The AI model is instructed **not** to write any credit / subscribe / link lines.
2. The assembler (\`src/lib/youtube-description.ts\`) **strips any legacy-credit line** the model might still emit, then appends the canonical \`CREDIT_BLOCK\`.
3. Output order is always: **song body → credit block → Subscribe/site/playlist links → hashtags**.
4. A test (\`__tests__/lib/youtube-description.test.ts\`) fails the deploy if the banned phrases ever reappear — so the policy can't silently drift back.

## How to verify
- **Live:** open \`/admin/compose\`, compose any song, click **Copy ready-to-paste** on the Tamil or English description card → the pasted text contains the block above and none of the banned phrases.
- **Automated:** run \`npx jest youtube-description\` → the "permanent credit block" tests confirm the block is emitted and the banned phrases are stripped even when present in the AI body.
- **Catalogue:** open any song on YouTube and expand the description; the 3-line block should be there.

## History
- **2026-07-08:** swept the whole back-catalogue — **56 videos** migrated from the old \`Lyrics & poetry: 100% original… / Music composition: AI-assisted.\` wording to the block above, and locked the composer so new uploads stay consistent.
`,
  },
];

/** Docs grouped by category, in registry order, for the sidebar. */
export function docsByCategory(): Record<string, AdminDoc[]> {
  return ADMIN_DOCS.reduce<Record<string, AdminDoc[]>>((acc, d) => {
    (acc[d.category] ||= []).push(d);
    return acc;
  }, {});
}

export function getDoc(slug: string): AdminDoc | undefined {
  return ADMIN_DOCS.find((d) => d.slug === slug);
}
