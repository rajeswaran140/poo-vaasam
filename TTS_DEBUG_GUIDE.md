# TTS Debugging Guide

## 🔍 Quick Diagnosis

The TTS 503 error you're experiencing is caused by **Google Cloud Text-to-Speech API not being enabled** for your project.

### The Root Cause

Your service account credentials are valid, but the API itself needs to be activated in Google Cloud Console.

---

## 🛠️ How to Fix (3 Easy Steps)

### Step 1: Enable the API

Click this link to go directly to the API page:

**https://console.developers.google.com/apis/api/texttospeech.googleapis.com/overview?project=319317366187**

1. Click the **"Enable"** button
2. Wait for the confirmation message

### Step 2: Wait for Propagation

After enabling:
- Wait **2-5 minutes** for changes to propagate
- Google needs time to activate the API across their systems

### Step 3: Test the Configuration

Run the test script locally:

```bash
npm run test:tts
```

Or visit the debug page after deployment:
- Local: http://localhost:3000/debug/tts
- Production: https://tamilagaval.com/debug/tts

---

## 📊 Available Debug Tools

### 1. CLI Test Script
```bash
npm run test:tts
```

**What it checks:**
- ✓ Environment variables loaded
- ✓ Credentials file exists and is valid
- ✓ Base64 credentials can be parsed
- ✓ TTS client can initialize
- ✓ API connection works
- ✓ Tamil voices are available
- ✓ Audio can be generated

### 2. Debug API Endpoint

**Endpoint:** `GET /api/tts/debug`

Returns JSON with:
```json
{
  "status": "OK" | "ERROR",
  "debug": {
    "credentials": { ... },
    "parsedCredentials": { ... }
  },
  "clientStatus": { ... }
}
```

### 3. Interactive Debug Page

**URL:** `/debug/tts`

Features:
- 🎯 Visual status indicators
- 📋 Detailed configuration display
- 🔄 Real-time refresh
- 🎵 Test audio generation
- 💡 Contextual troubleshooting tips

---

## ✅ Expected Test Results (After Fixing)

When everything is working, you should see:

```
============================================================
✅ ALL TESTS PASSED - TTS is properly configured!
============================================================

Available Tamil voices: 4

Tamil Voices:
  1. ta-IN-Wavenet-A (FEMALE)
  2. ta-IN-Wavenet-B (MALE)
  3. ta-IN-Wavenet-C (FEMALE)
  4. ta-IN-Wavenet-D (MALE)

✓ Audio generated successfully (XXXXX bytes)
```

---

## 🔧 For Production (AWS Amplify)

After enabling the API, you still need to configure credentials in Amplify:

### Generate Base64 Credentials

```bash
cat credentials/google-tts-service-account.json | base64 -w 0
```

### Add to Amplify

1. Go to AWS Amplify Console → Your App → Environment variables
2. Add variable:
   - **Name:** `GOOGLE_TTS_CREDENTIALS_BASE64`
   - **Value:** [paste the base64 string]
3. Save and redeploy

### Verify on Production

Visit: https://tamilagaval.com/debug/tts

You should see:
- ✓ GOOGLE_TTS_CREDENTIALS_BASE64: SET
- ✓ Parsed Credentials: OK
- ✓ TTS Client Status: OK

---

## 🚨 Common Issues

### Issue: "API has not been used in project"
**Solution:** Enable the API using the link in Step 1 above

### Issue: "PERMISSION_DENIED"
**Solution:**
1. Enable the Text-to-Speech API
2. Check service account has `roles/cloudtexttospeech.user` role

### Issue: "Invalid credentials format"
**Solution:**
- Regenerate base64 string
- Ensure no extra spaces or line breaks
- Copy the ENTIRE base64 string

### Issue: Works locally but not on production
**Solution:**
1. Verify `GOOGLE_TTS_CREDENTIALS_BASE64` is set in Amplify
2. Check the base64 string is complete (very long)
3. Redeploy after adding the variable

---

## 📝 Notes

- **Local development:** Uses `GOOGLE_APPLICATION_CREDENTIALS` (file path)
- **Production (Amplify):** Uses `GOOGLE_TTS_CREDENTIALS_BASE64` (encoded string)
- **Priority:** Base64 credentials take precedence over file path
- **Cache:** Audio is cached for 1 year - first request is slow, subsequent are instant

---

## 🆘 Still Having Issues?

1. Run `npm run test:tts` and share the output
2. Visit `/debug/tts` and take a screenshot
3. Check Amplify deployment logs for errors
4. Verify Google Cloud Console → APIs & Services → Text-to-Speech API shows "Enabled"

---

## 📚 Related Documentation

- [GOOGLE_TTS_SETUP.md](./GOOGLE_TTS_SETUP.md) - Complete setup guide
- [AMPLIFY_ENV_SETUP.md](./AMPLIFY_ENV_SETUP.md) - Amplify environment variables
- [Google Cloud TTS Docs](https://cloud.google.com/text-to-speech/docs)
