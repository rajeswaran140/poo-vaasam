# 🚀 Deployment Guide - பூ வாசம் (Poo Vaasam)

Complete deployment instructions for your Tamil content platform.

---

## 📋 Pre-Deployment Checklist

Before deploying, ensure:

- [x] Production build succeeds (`npm run build`)
- [x] All changes committed and pushed to GitHub
- [x] Environment variables documented
- [ ] AWS credentials configured (if using AWS services)
- [ ] Domain name ready (optional)

---

## 🌟 Option 1: Vercel (Recommended - Fastest)

**Best for:** Quick deployment, automatic CI/CD, excellent Next.js optimization

### Advantages:
✅ Zero configuration needed
✅ Automatic deployments on git push
✅ Built-in CDN and edge functions
✅ Free SSL certificates
✅ Perfect Next.js integration

### Steps:

#### 1. Sign up for Vercel
- Visit https://vercel.com/signup
- Sign in with your GitHub account

#### 2. Deploy via Vercel Dashboard (Easiest)

1. Go to https://vercel.com/new
2. Click "Import Git Repository"
3. Select "rajeswaran140/poo-vaasam" from GitHub
4. Configure project:
   - Framework Preset: Next.js (auto-detected)
   - Root Directory: ./
   - Build Command: npm run build
   - Output Directory: .next
5. Add Environment Variables (see below)
6. Click "Deploy"

#### 3. Or Deploy via CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login to Vercel
vercel login

# Deploy
cd C:\Users\rajes\techweb\Tamil-web
vercel

# Deploy to production
vercel --prod
```

#### 4. Environment Variables

Add these in Vercel Dashboard → Settings → Environment Variables:

```env
# AWS Credentials
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_DYNAMODB_TABLE_NAME=TamilWebContent
NEXT_PUBLIC_S3_BUCKET=tamil-web-media
NEXT_PUBLIC_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key

# App Configuration  
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
```

⚠️ **Important:** Add to "Production" environment, DO NOT commit AWS credentials to Git

#### 5. Custom Domain (Optional)

1. Vercel Dashboard → Settings → Domains
2. Add domain (e.g., poo-vaasam.com)
3. Update DNS records as shown
4. Update NEXT_PUBLIC_APP_URL

**Deployment Time:** 2-3 minutes  
**Live URL:** https://poo-vaasam.vercel.app

---

## 🔶 Option 2: AWS Amplify

**Best for:** Full AWS ecosystem integration

### Quick Deploy:

```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# Configure
amplify configure

# Initialize
cd C:\Users\rajes\techweb\Tamil-web
amplify init

# Add hosting
amplify add hosting

# Publish
amplify publish
```

### Or via AWS Console:

1. Go to AWS Amplify Console
2. Click "New app" → "Host web app"
3. Connect GitHub repository
4. Select "rajeswaran140/poo-vaasam"
5. Configure build settings:
   - Build command: npm run build
   - Base directory: /
   - Output directory: .next
6. Add environment variables
7. Deploy

**Deployment Time:** 5-10 minutes

---

## 🔧 Post-Deployment

### 1. Test Routes

- ✅ https://your-domain.com/
- ✅ https://your-domain.com/songs
- ✅ https://your-domain.com/poems  
- ✅ https://your-domain.com/admin

### 2. Update S3 CORS

Add your production domain to S3 bucket CORS configuration.

### 3. Monitor

Check Vercel/Amplify dashboard for:
- Build logs
- Runtime errors
- Performance metrics

---

## 🎯 Recommended: Start with Vercel

**Why Vercel?**
- ✅ 5-minute setup
- ✅ Free tier for testing
- ✅ Automatic HTTPS
- ✅ Built-in CDN
- ✅ Perfect for Next.js

**Deploy now:**
```bash
npm i -g vercel
vercel login
cd C:\Users\rajes\techweb\Tamil-web
vercel --prod
```

---

**Status**: ✅ Ready to Deploy  
**Repository**: https://github.com/rajeswaran140/poo-vaasam  
**Latest Commit**: f1d214f (Fix production build and optimize for deployment)

🚀 Let's go live!
