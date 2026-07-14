# YouTube Community Posts — Tamilagaval

The Community tab (`youtube.com/@Tamilagaval/posts`) is currently **empty**. It's free, owned, push-style reach to subscribers (shows in their home feed + notifications) — the lever that fills the gap between uploads, nudges sub-conversion, and feeds WhatsApp shares.

**There is NO API for creating Community posts** — they must be posted manually in **YouTube Studio → Content → Posts → Create** (or the mobile app). Copy a block below, attach the named asset, post.

**Cadence:** 2–3 posts/week. Rotate the four types. Keep it bilingual (Tamil hook + romanized), apolitical, warm.

---

## Post 1 — New-song teaser (post on upload day)

**Attach:** the new song's cover / YouTube thumbnail (square or 16:9).

```
🎵 புதிய பாடல் வெளியாகிவிட்டது!

«[SONG NAME IN TAMIL]» — இதயத்தைத் தொடும் புதிய தமிழ் பாடல்.
A brand-new original Tamil song is out now.

▶️ முழுப் பாடலை YouTube-ல் பார்க்க / Watch the full song 👇
[VIDEO LINK]

பிடித்திருந்தால் WhatsApp-ல் உங்கள் நண்பர்களுடன் பகிருங்கள் 💛
Loved it? Share it on WhatsApp with your friends.

#TamilSongs #Tamilagaval #புதியபாடல்
```

**Worked example** (swap for the actual latest song):
```
🎵 புதிய பாடல் வெளியாகிவிட்டது!

«நீ சிரிச்ச நேரம் தான்» ❤️ — இதயத்தைத் தொடும் புதிய காதல் பாடல்.
A brand-new original Tamil love song is out now.

▶️ முழுப் பாடலை YouTube-ல் பார்க்க 👇
https://youtu.be/GXLu3Y7FghU

பிடித்திருந்தால் WhatsApp-ல் பகிருங்கள் 💛
#TamilSongs #Tamilagaval #காதல்பாடல்
```

---

## Post 2 — Poll (highest engagement; feeds the next composer brief)

**Type:** Poll (text options only, no image).

```
அடுத்த பாடல் எந்த உணர்வில் இருக்கணும்? 🎶
Which mood should the next song be?
```
Options:
```
காதல் ❤️ (Love)
தாய் பாசம் 💛 (Mother / family)
இயற்கை & கிராமம் 🌾 (Nature / village)
பக்தி 🙏 (Devotional)
```

---

## Post 3 — Short / Status clip (drive WhatsApp shares)

**Attach:** a vertical Short/Status clip (use `scripts/generate-song-short.ts` output or a staged clip).

```
ஒரு நிமிட இன்பம் 🎧 — இந்தப் பாடலின் சிறந்த வரிகள்.
A one-minute taste of our latest song.

முழுப் பாடல் YouTube-ல் / Full song on YouTube 👇
[VIDEO LINK]

இந்த clip-ஐ உங்கள் WhatsApp Status-ல் போடுங்க! 📲
Put this on your WhatsApp Status to share.

#Shorts #TamilSongs #Tamilagaval
```

---

## WhatsApp share templates (per song)

WhatsApp is the #1 organic channel for the diaspora audience, and a warm
pre-filled message gets forwarded far more than a bare URL. Share the **YouTube
link** directly (not a site page) — it feeds the `EXT_URL` external-traffic
signal that seeds YouTube's related/suggested engine. Register stays respectful
(-உங்கள்: கேளுங்கள் / ரசியுங்கள் / பகிருங்கள்). Never name any AI music tool.

**Card asset:** a 1200×630 preview (WhatsApp/OG ratio) can be cut from the song's
maxres YouTube thumbnail with ffmpeg (blurred fill + centred thumbnail + a
`TamilAgaval.com` strip); see the `காதோட ஆடும் லோலாக்கு` card in `~/share-cards/`.

**Direct share / forward:**
```
🎵 [SONG TITLE] — புதிய [genre, e.g. கிராமத்து காதல்] பாடல்.
இதயம் தொட்ட மெல்லிசை; கேட்டு ரசியுங்கள், நண்பர்களுடன் பகிருங்கள் 🌾❤️
👉 [youtu.be LINK]
```

**Short, for WhatsApp Status:**
```
🎵 [SONG TITLE] 🌾 புதிய காதல் பாடல் — கேளுங்கள் 👇
[youtu.be LINK]
```

### Filled per-song kits

**காதோட ஆடும் லோலாக்கு — Kaathoda Aadum Lolakku (`ye9DsyXBEII`)** · கிராமத்து காதல்
_Card:_ `~/share-cards/kaathoda-lolakku-wa-1200x630.png`
```
🎵 காதோட ஆடும் லோலாக்கு — புதிய கிராமத்து காதல் பாடல்.
இதயம் தொட்ட மெல்லிசை; கேட்டு ரசியுங்கள், நண்பர்களுடன் பகிருங்கள் 🌾❤️
👉 https://youtu.be/ye9DsyXBEII
```

**வா... வா... அன்பே... — Vaa Vaa Anbe (`wMDQvdpap30`)** · காதல் மெல்லிசை (duet)
_Card:_ `~/share-cards/vaa-vaa-anbe-wa-1200x630.png`
```
🎵 வா... வா... அன்பே... — புதிய காதல் மெல்லிசை.
ஒரு மாலைப் பொழுதில், சொல்லாத வார்த்தைகளில் மலரும் காதல்.
கேட்டு ரசியுங்கள், நண்பர்களுடன் பகிருங்கள் 🌾❤️
👉 https://youtu.be/wMDQvdpap30
```
_Status (short):_
```
🎵 வா... வா... அன்பே... 🌾 புதிய காதல் மெல்லிசை — கேளுங்கள் 👇
https://youtu.be/wMDQvdpap30
```
_Pin-ready comment (paste, then ⋮ → Pin — API can't pin):_
```
🎵 "வா... வா... அன்பே..." — ஒரு மாலைப் பொழுதில், சொல்லாத வார்த்தைகளில் மலரும் காதல். கேட்டு ரசியுங்கள், உங்கள் கருத்தை பகிருங்கள் 🙏
A melody of unspoken love. If it moved you, share it with someone 🌾
```

---

## Post 4 — Milestone / behind-the-scenes (community building)

**Attach:** optional — a cover, channel art, or none.

```
நன்றி நண்பர்களே 🙏
[N] subscribers நெருங்குறோம் — உங்கள் அன்பும் பகிர்வும் தான் இந்த பயணம்.
Thank you all — we're closing in on [N] subscribers. Your love and shares power this.

இன்னும் நிறைய புதிய தமிழ் பாடல்கள் வரும் — subscribe செய்து, மணியை அழுத்துங்க 🔔
More original Tamil songs on the way — subscribe & hit the bell.

#Tamilagaval #TamilSongs
```

---

## Quick checklist per post
- [ ] Bilingual (Tamil hook first, then romanized/English)
- [ ] One clear CTA (watch / vote / share-to-WhatsApp)
- [ ] Right asset attached (cover / Short clip / none for polls)
- [ ] Apolitical, warm tone
- [ ] 1–3 hashtags incl. `#Tamilagaval`

---

## Comments policy (moderation)

Content-neutral house rule: welcome song-related comments, hide off-topic / personal-conversation / inappropriate ones. Apply the same standard to everyone (positive, negative, or off-topic) — consistency is the whole point. There is **no API** for pinning comments or for the Studio comment filters — these are manual.

**1. Pin-ready comment** (paste on key videos, then ⋮ → Pin — API can't pin):
```
🎵 தமிழகவல் — பாடல்கள், பாடல் வரிகள், இசை, அவை தரும் உணர்வுகள் பற்றிய மரியாதையான கருத்துகளை வரவேற்கிறோம். தொடர்பற்ற அல்லது தனிப்பட்ட உரையாடல்கள் சமூகத்தை நேர்த்தியாக வைத்திருக்க மறைக்கப்படலாம். 🙏
We welcome respectful comments about our songs, lyrics, and the emotions they inspire. Unrelated or personal-conversation comments may be hidden to keep this space welcoming and focused.
```

**2. Description-footer one-liner** (add to every NEW upload's description):
```
💬 பாடல் தொடர்பான மரியாதையான கருத்துகளை வரவேற்கிறோம் / We welcome respectful, song-related comments.
```

**3. Studio filters that ENFORCE it** (Settings → Community → Automated filters — do once):
- [ ] Turn ON **"Hold potentially inappropriate comments for review"**
- [ ] Add a small **Blocked words** list for any recurring off-topic / spam phrase
- [ ] Use per-comment **"Hide user from channel"** for repeat off-topic posters (soft, silent)
