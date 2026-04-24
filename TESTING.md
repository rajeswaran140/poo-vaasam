# Manual Testing Guide for Tamil Poetry Features

## Prerequisites
- Dev server running: `npm run dev`
- Browser: Chrome/Edge (best Tamil voice support)
- Have at least one poem in the database

## Feature Testing Checklist

### 1. AI Poem Analysis
**What it does**: Analyzes Tamil poem emotion when page loads

**How to test**:
1. Open any poem page (e.g., `/content/[poem-id]`)
2. Open browser DevTools Console (F12)
3. Look for fetch call to `/api/ai/analyze-poem`
4. Should see response with `emotion`, `mood`, `themes`

**Expected behavior**:
- ✅ API called automatically on page load
- ✅ No errors in console
- ✅ Returns emotion like "sad", "joyful", etc.

**Troubleshooting**:
- If 500 error: Check `OPENAI_API_KEY` in `.env.local`
- If timeout: OpenAI API may be slow, wait 10-15 seconds

---

### 2. Context-Aware Background Music
**What it does**: Plays emotion-appropriate music

**How to test**:
1. Open a poem page
2. Click the music button (🎵 musical note icon)
3. Should hear music start playing
4. Volume control panel should appear (bottom-left)

**Expected behavior**:
- ✅ Music plays when button clicked
- ✅ Button shows purple highlight when playing
- ✅ Volume slider appears
- ✅ Can adjust volume 0-100%
- ✅ Music loops continuously
- ✅ Clicking again stops music

**Troubleshooting**:
- If no sound: Check browser volume, unmute tab
- If error alert: Check browser console for CORS/network errors
- If wrong music: Check console for poem analysis results

---

### 3. Browser Tamil TTS (Text-to-Speech)
**What it does**: Reads poem aloud in Tamil with emotion-aware voice

**How to test**:
1. Open a poem page
2. Wait 5 seconds for analysis to complete
3. Click speaker button (🔊)
4. Should hear Tamil speech

**Expected behavior**:
- ✅ Tries Google Cloud TTS first (will fail gracefully)
- ✅ Falls back to browser Web Speech API
- ✅ Speaks in Tamil language
- ✅ Speech speed varies by emotion:
  - Sad poems: Slower, lower pitch
  - Joyful poems: Faster, higher pitch
- ✅ Button shows green highlight when speaking
- ✅ Clicking again stops speech

**Troubleshooting**:
- If no voice: Browser may not have Tamil voices installed
  - Chrome: Tamil voice built-in
  - Firefox: May need system Tamil language pack
  - Safari: Tamil supported on macOS/iOS
- If wrong language: Check console for warnings
- If error: See console for API/fallback issues

---

### 4. Reading Modes
**What it does**: Changes background color for comfortable reading

**How to test**:
1. Click ☀️ (வெளிச்சம்) - Light mode
2. Click 🌙 (இருட்டு) - Dark mode
3. Click 📜 (செப்பியா) - Sepia mode

**Expected behavior**:
- ✅ Background changes immediately
- ✅ Text color adjusts for contrast
- ✅ Preference saved in localStorage

---

### 5. Mobile Responsiveness
**What it does**: Adapts layout for mobile devices

**How to test**:
1. Open DevTools (F12)
2. Click device toolbar icon (Ctrl+Shift+M)
3. Select "iPhone 12 Pro" or similar
4. Refresh page

**Expected behavior**:
- ✅ Toolbar shows 2 rows (modes + actions)
- ✅ Buttons show icons only (no text)
- ✅ Poem displays in single column
- ✅ Text left-aligned, readable
- ✅ No horizontal scroll
- ✅ Volume control fits on screen

**Breakpoints**:
- Mobile: < 640px (single column, icon buttons)
- Tablet: 640-1023px (single column, full buttons)
- Desktop: ≥1024px (two columns, full layout)

---

## Automated Tests

Run tests with:
```bash
npm test
```

Current test coverage:
- ✅ Music Library (10 tests)
- ✅ AI Poem Analysis API (4 tests)
- ✅ PoemReader Integration (8 tests)

---

## Known Issues / Limitations

1. **Google Cloud TTS**: Disabled due to billing issues
   - ✅ **Fallback working**: Browser TTS used instead
   - Quality: Browser TTS is acceptable but not as good as Google

2. **Tamil Voice Quality**: Varies by browser
   - Chrome: Good quality
   - Firefox: Fair quality
   - Safari: Good on Apple devices

3. **Music Sources**: Using free Bensound library
   - Some tracks may not load due to CORS
   - Fallback system ensures something always plays

4. **AI Analysis**: Requires OpenAI API key
   - Cost: ~$0.01 per poem analysis
   - Fallback: Defaults to "sad/somber" if fails

---

## Quick Test URLs

Assuming dev server on `http://localhost:3002`:

- **Home**: http://localhost:3002
- **Poems list**: http://localhost:3002/poems
- **Individual poem**: http://localhost:3002/content/[your-poem-id]

Replace `[your-poem-id]` with actual poem ID from your database.

---

## Success Criteria

All features working if:
- ✅ Music plays with volume control
- ✅ Tamil TTS speaks (even if browser quality)
- ✅ AI analysis returns emotion data
- ✅ Mobile layout doesn't break
- ✅ No console errors (warnings OK)

## Need Help?

Check browser console (F12) for error messages and include them in your bug report.
