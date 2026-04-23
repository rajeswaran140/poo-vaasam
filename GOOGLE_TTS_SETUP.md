# Google Cloud TTS Setup Guide

## 🔧 Quick Fix for 503 Error

If you see **"503 Service Unavailable"** when trying to generate audio, follow these steps:

### **Step 1: Verify Credentials File Exists**

```bash
ls -la credentials/google-tts-service-account.json
```

✅ Should show the file exists

### **Step 2: Check Environment Variable**

```bash
cat .env.local | grep GOOGLE
```

✅ Should show:
```
GOOGLE_APPLICATION_CREDENTIALS=/home/devuser/projects/poo-vaasam/credentials/google-tts-service-account.json
```

### **Step 3: Restart Dev Server**

The dev server must be restarted to pick up the new environment variable:

```bash
# Kill existing server
pkill -f "node.*next"

# Start fresh
npm run dev
```

Wait 10 seconds for server to fully start.

### **Step 4: Test the API**

```bash
curl -X POST http://localhost:3000/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "வணக்கம்", "voice": "female"}' \
  --output test-audio.mp3

# If successful, you'll have test-audio.mp3 file
file test-audio.mp3  # Should say: "Audio file with ID3 version 2.4.0"
```

---

## 🚀 For Production (AWS Amplify)

### **Option 1: Upload Credentials File** (Easiest)

1. Copy `credentials/google-tts-service-account.json` to your Amplify app
2. Set environment variable in Amplify:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=/app/credentials/google-tts-service-account.json
   ```

### **Option 2: Base64 Encoded** (More Secure)

1. **Encode the credentials**:
   ```bash
   cat credentials/google-tts-service-account.json | base64 -w 0 > credentials.txt
   ```

2. **Copy the output** and add to Amplify Environment Variables:
   ```
   GOOGLE_TTS_CREDENTIALS_BASE64=[paste the base64 string here]
   ```

3. The code will automatically detect and use this.

---

## 🧪 Testing Tamil Voices

Test all 4 Tamil voices:

```bash
# Female Voice A (Default)
curl -X POST http://localhost:3000/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "வணக்கம், நான் பெண் குரல் A", "voice": "female"}' \
  --output female-a.mp3

# Male Voice B
curl -X POST http://localhost:3000/api/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "வணக்கம், நான் ஆண் குரல் B", "voice": "male"}' \
  --output male-b.mp3
```

Play the files to compare quality!

---

## 📊 Monitoring Usage & Costs

### **View Usage**:
https://console.cloud.google.com/apis/api/texttospeech.googleapis.com/quotas

### **Current Project**: `secret-manager-service`

### **Free Tier**:
- WaveNet: 1M characters/month FREE
- Standard: 4M characters/month FREE

### **Set Budget Alerts**:
https://console.cloud.google.com/billing/budgets

---

## ❌ Common Errors

### **Error: "GOOGLE_APPLICATION_CREDENTIALS not set"**
**Fix**: Restart dev server after adding to `.env.local`

### **Error: "Permission denied"**
**Fix**: Check service account has `roles/cloudtexttospeech.user` permission

### **Error: "Project quota exceeded"**
**Fix**: Check usage at Google Cloud Console, upgrade if needed

### **Error: "Invalid credentials"**
**Fix**: Verify JSON file is valid:
```bash
cat credentials/google-tts-service-account.json | python3 -m json.tool
```

---

## 🎤 Available Tamil Voices

| Voice ID | Gender | Description | Best For |
|----------|--------|-------------|----------|
| ta-IN-Wavenet-A | Female | Clear, professional | News, Formal content |
| ta-IN-Wavenet-B | Male | Deep, authoritative | Narration, Poetry |
| ta-IN-Wavenet-C | Female | Soft, gentle | Stories, Children |
| ta-IN-Wavenet-D | Male | Natural, conversational | Casual content |

---

## 📝 Notes

- Audio is cached for 1 year (per poem text)
- First request takes ~3-5 seconds
- Subsequent requests are instant (cached)
- Max text length: 5000 characters
- Format: MP3 (universal compatibility)
- Quality: 24kHz sampling rate

---

**Questions?** Check the logs:
```bash
tail -f /tmp/dev-tts.log
```
