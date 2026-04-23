# AWS Amplify Environment Variables Setup

## Required Environment Variables

Add these environment variables in your AWS Amplify Console:

### 1. Google Cloud Text-to-Speech

**Variable Name:** `GOOGLE_TTS_CREDENTIALS_BASE64`

**Value:** (The base64 encoded credentials string I provided earlier)

```
ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIsCiAgInByb2plY3RfaWQiOiAic2VjcmV0LW1hbmFnZXItc2VydmljZSIsCiAgInByaXZhdGVfa2V5X2lkIjogImI3OWJkMzQzNzc1NTI1YjZiODNlNDNiNjcxMWNhMWU0YzJhYTUwYmEiLAogICJwcml2YXRlX2tleSI6ICItLS0tLUJFR0lOIFBSSVZBVEUgS0VZLS0tLS1cbk1JSUV2UUlCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktjd2dnU2pBZ0VBQW9JQkFRQzh4TUY4S0YzZjgxd2tcbkZYOGYxejRrQjQyWjRqS0pBdDhjSkpjazhsM05acmxEcmtzWGE2MWxkTnlDQUFkd0hucUR2MEtYS1REYUpSU0xcbkdRY2RYSGpoQ3Z0MVZxNjk5U1BYZWFVM3JYMVJlNUtjWVhYSW1PU0Y3WVg3YnRMYkllc21lQlAzUWUxQnNqRk9cbk9lL3dZVWVNd2VkdlVObG45d0hMem9KckxZWXNHUnlCdWMzTzVFREUvejhrQU1EWmRHcU9qY2w0MHJFZkRRaUNcbktBUEd4Q2Y0eDRGam9hUTFhOEU5S0Z3cHBrRHJpeXRWdmlTREg2YXdzbkJONVloRGg1M09pdmc4clBNNjhJbUxcbmxOYnI1MkhmUjJRdWoyMVhoRjNGUXRTdGF1dzN0OTJWYnFQcStGVXRFNUNDTlozV1VrcUszR1hNeHFMNWFRbnhcbm13T1BHUWROQWdNQkFBRUNnZ0VBRmJabVFOMEJpSlpQM0lBOE1zSUJJazFnRkJPY0NLeUtMQWYrZjc4Y3hvZnJcbjQ0SHdsY3ROZmtEanVpRkw5eW5CaW5PQjZ3V2lyUUJscTBCMXc5MUNIakFoR3RiSkxoOEJGQ3lGcWdRRWpUUjZcblJ5blA3QjdHRXE3cFEvb3N3ZDE2ZEVSZUV1TkRhQmt6NEU3VDJDT0tRNFFuN080UUpDQllwQWZ5TTJMajdwOW9cbkhON1pxbEVHRGVobWJVOW1IeGVDQnQ2VTBlaUJFdjN1YitJSUVJa3BTbVQva0E4WTdCN0NOdW0yT3o5Qjh3RDZJXG5nSk9PUEZOc3k3bXdaWndlWE85OFoyYWhobk43ZnBEaThBY3dMSldha0xiUERYR1kzT2tneHd3MStLSFpUR25pXG5pdCtPdk02dDRaQ0ZUbWVCWGc2RXZJeTlhUWx5YlZaeXdZTGJHMy9vS1FLQmdRRG9VVjhoTXBkdE9LZTA1Tzh3XG5sbitFVG9kaFQvVFpNY1F0bWxKeWJqbGNpeXVLNXQ4R2tKRDhJb3hvZC9zYis3d0dxYVdYRDNUWWhkM3plTkhDXG5CQVdmQ21QZFFqN1lWcFJmajZsSWxyYS9vUm1kNUpOWEowVHh3QTdyV0YzRUdzQXBSOVY4MytIZ0Q3b1gzVFdFXG50a1V4VjFBQVFCUVZyZWhOeFUrajFCeVhvd0tCZ1FEUXVyOUJKbG9MZDczRjRJWUxMRnpUZWRveEJKOW5GRmZBXG5PVDdJYlRVd0RJT2YrR0U4Z0FMV0crRGgxcG5WUFJrbnhtWWxXd1dyZXQ5ejBCWGY5VnhTcVNLMEFSaWErRVF3XG5PRXVpcFVRb1Q4cFphR0VMcU5ocTlPaFd2anJET0dKbFkwNStoSkR5NjhHUWdYYkd1M0JhMDhCTTB6dFZXWFRHXG4vSVNvOGFBV01RS0JnRGRKZnM2WlRFNU5rU3FCSlBCbTNiUXBiZEMwZjBFVUhscmkzdGhaNkg5SmppZGt3U2EzXG5VR04rc1JLRTJGNFpIaERQWmFib2JWMGh4ZEhiRzVBTVkxZWdVdHJhMFFUdGlmQUlQcVpaMmwyUVpRaGZ6YTZMXG5jRjczYjVrSVdaOXdxdEk0RWh3eGxmVzR2RFJKaXYvY2RGRG5FYytzZFpQdUtQZFB5bnIxQzVyQkFvR0FkWUtjXG5sMGdHeWNWZFFYcEV2MnFRNmJZNTVGNEJxZU5iSmpTZ2RNdlVqdUJTcmFEMkI2TzhlRWxMVjVKR203UExJclFrXG5WV2swN1MvT1p2bzc5OXl2RzRuVEc2SnRYVDFLSjE3V0REdHJ2OGVhcklVOGp6RGdDdkZZY3k5cTB5UjdsOG0wXG4vOGtkQTdlb2dCREJPc0crYjh5WXIraTlCcU1DbWxJbGZieEhiYjhDZ1lFQXFYQVZKZmlURVFTRkpZNVB5Q25CXG44eWI0SEEyeFdNQ25YUTZUejh4VWhRZ1FIMmRvUnpzK2lWa29vOU5zU0xGSllrdWdnWjJJUnB0RXFBa3d6YTBCXG5XVUNSckprSHJ2K29QMU40ckQzMkloT3QrczF1MnlJWnhDd3M2aWVpcURFZStOdnNWNnhTdXZDenFNZDRJamNyXG5ZeTlXQ2luSmZoRWVnN3hEcDl5dTVzdz1cbi0tLS0tRU5EIFBSSVZBVEUgS0VZLS0tLS1cbiIsCiAgImNsaWVudF9lbWFpbCI6ICJyYWplc3dhcmFuMTQwQHNlY3JldC1tYW5hZ2VyLXNlcnZpY2UuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLAogICJjbGllbnRfaWQiOiAiMTEyMTAyNDQyMTgxNTk1MTI2OTkzIiwKICAiYXV0aF91cmkiOiAiaHR0cHM6Ly9hY2NvdW50cy5nb29nbGUuY29tL28vb2F1dGgyL2F1dGgiLAogICJ0b2tlbl91cmkiOiAiaHR0cHM6Ly9vYXV0aDIuZ29vZ2xlYXBpcy5jb20vdG9rZW4iLAogICJhdXRoX3Byb3ZpZGVyX3g1MDlfY2VydF91cmwiOiAiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vb2F1dGgyL3YxL2NlcnRzIiwKICAiY2xpZW50X3g1MDlfY2VydF91cmwiOiAiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vcm9ib3QvdjEvbWV0YWRhdGEveDUwOS9yYWplc3dhcmFuMTQwJTQwc2VjcmV0LW1hbmFnZXItc2VydmljZS5pYW0uZ3NlcnZpY2VhY2NvdW50LmNvbSIsCiAgInVuaXZlcnNlX2RvbWFpbiI6ICJnb29nbGVhcGlzLmNvbSIKfQ==
```

### 2. OpenAI API (for Semantic Search)

**Variable Name:** `OPENAI_API_KEY`

**Value:** `[Your OpenAI API key from .env.local]`

### 3. Anthropic Claude API (for Poetry Chat)

**Variable Name:** `ANTHROPIC_API_KEY`

**Value:** `[Your Anthropic API key from .env.local]`

---

## How to Add Environment Variables in AWS Amplify

### Step-by-Step Instructions:

1. **Open AWS Amplify Console**
   - Go to https://console.aws.amazon.com/amplify/
   - Select your app (tamilagaval)

2. **Navigate to Environment Variables**
   - Click on "Hosting environments" in the left sidebar
   - Select your main branch (usually `master` or `main`)
   - Click on "Environment variables" tab

3. **Add Each Variable**
   - Click "Manage variables" or "Add variable"
   - For each variable above:
     - Enter the **Variable Name** (exactly as shown)
     - Paste the **Value** (the full string, no quotes)
     - Click "Save"

4. **Redeploy Your Application**
   - After adding all variables, trigger a new deployment
   - Either:
     - Push a new commit to your repository, OR
     - Click "Redeploy this version" in the Amplify console

5. **Verify the Deployment**
   - Wait for the build to complete (~3-5 minutes)
   - Test the TTS feature on a poem page
   - Check browser console for any errors

---

## Troubleshooting

### Error: "503 Service Unavailable"

**Cause:** Environment variable not set or incorrectly configured

**Solution:**
1. Double-check the variable name is exactly `GOOGLE_TTS_CREDENTIALS_BASE64`
2. Ensure the base64 string has no extra spaces or line breaks
3. Redeploy after making changes

### Error: "Invalid Google TTS credentials format"

**Cause:** Base64 string is corrupted or incomplete

**Solution:**
1. Copy the base64 string again (from this document or the earlier conversation)
2. Make sure you copied the ENTIRE string (it's very long)
3. Paste it without any modifications

### Error: "Failed to generate audio"

**Cause:** Google Cloud API not enabled or service account lacks permissions

**Solution:**
1. Verify the Text-to-Speech API is enabled in Google Cloud Console
2. Check the service account has `roles/cloudtexttospeech.user` permission
3. View logs in Amplify Console → Deployment → View logs

---

## Verification Checklist

After deployment, verify these work:

- [ ] Open any poem page (e.g., https://tamilagaval.com/poems/[id])
- [ ] Click the "கவிதையை கேட்க உருவாக்கு" button
- [ ] Audio should generate within 3-5 seconds
- [ ] No 503 errors in browser console
- [ ] AI Search works at /ai-search
- [ ] Poetry Guide Chat appears and responds

---

## Important Notes

1. **Security:** Never commit API keys or credentials to Git
2. **Build Time:** Environment variables are only available at runtime, not during build
3. **Caching:** Audio is cached for 1 year - first request is slow, subsequent are instant
4. **Costs:** Monitor usage at https://console.cloud.google.com/billing

---

## Support

If issues persist:
1. Check Amplify deployment logs
2. Check Google Cloud Console quotas
3. Verify all 3 environment variables are set correctly
4. Test locally first with `.env.local` to isolate the issue
