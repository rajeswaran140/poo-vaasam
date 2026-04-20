# 🌐 Frontend Server Information

Quick reference for accessing your Tamil content platform locally.

---

## 📍 **Local Access URLs**

### **Primary URLs** (After running `npm run dev` or `start-server.bat`)

```
Homepage:          http://localhost:3000
Songs Page:        http://localhost:3000/songs
Poems Page:        http://localhost:3000/poems
Admin Dashboard:   http://localhost:3000/admin
```

### **Network Access** (From other devices on same network)

```
http://100.64.147.101:3000
```

### **If Port 3000 is Busy**

Next.js will automatically use the next available port:
```
Port 3000 busy → Uses http://localhost:3002
Port 3002 busy → Uses http://localhost:3003
...and so on
```

Check your terminal for:
```
✓ Ready in 3.2s
  - Local:   http://localhost:XXXX  ← Use this URL
  - Network: http://...
```

---

## 🚀 **How to Start the Server**

### **Method 1: Using Batch File (Easiest)**

Double-click:
```
start-server.bat
```

This will:
1. Clean the .next folder
2. Start the dev server
3. Show the URL to access

### **Method 2: Using Terminal**

```bash
cd C:\Users\rajes\techweb\Tamil-web
npm run dev
```

### **Method 3: If .next Folder is Locked**

**Option A: Task Manager**
1. Press `Ctrl + Shift + Esc`
2. Find and end all `node.exe` processes
3. Delete `.next` folder manually
4. Run `npm run dev`

**Option B: PowerShell (as Administrator)**
```powershell
cd C:\Users\rajes\techweb\Tamil-web
taskkill /F /IM node.exe
Remove-Item -Recurse -Force .next
npm run dev
```

---

## 📁 **Project Directory**

```
C:\Users\rajes\techweb\Tamil-web
```

### **Key Files**

```
src/app/page.tsx              → Homepage (100% Tamil)
src/app/songs/page.tsx        → Songs listing (100% Tamil)
src/app/poems/page.tsx        → Poems listing (100% Tamil)
src/app/content/[id]/page.tsx → Content detail (100% Tamil)
src/app/(admin)/admin/        → Admin dashboard (English)
src/app/layout.tsx            → SEO metadata
```

---

## 🧪 **Testing the Server**

### **1. Check Server Status**

**Browser:**
```
http://localhost:3000
```

**Command Line:**
```bash
curl http://localhost:3000
```

### **2. Test API Endpoints**

```bash
# Get statistics
curl http://localhost:3000/api/test/content?action=stats

# List all content
curl http://localhost:3000/api/test/content?action=list

# Get by type
curl http://localhost:3000/api/test/content?action=by-type&type=SONGS
curl http://localhost:3000/api/test/content?action=by-type&type=POEMS
```

### **3. Test Admin Functions**

```bash
# Create content
curl -X POST http://localhost:3000/api/test/content \
  -H "Content-Type: application/json" \
  -d '{"action":"create-content","data":{"type":"SONGS","title":"Test","body":"Content","author":"Author","status":"PUBLISHED"}}'
```

---

## 🎯 **What You Should See**

### **Homepage** (`http://localhost:3000`)

```
✅ Header: "பூ வாசம்"
✅ Subtitle: "தமிழ் இலக்கிய தளம்"
✅ Buttons: "பாடல்கள்", "கவிதைகள்"
✅ Stats: "மொத்த உள்ளடக்கம்", "பாடல்கள்", "கவிதைகள்"
✅ Footer: All Tamil text
✅ 100% Tamil (ZERO English)
```

### **Songs Page** (`http://localhost:3000/songs`)

```
✅ Header: "தமிழ் பாடல்கள் தொகுப்பு"
✅ Back link: "← முகப்புக்குத் திரும்பு"
✅ Songs grid with Tamil metadata
✅ Audio badge: "🎵 ஒலி"
```

### **Admin Dashboard** (`http://localhost:3000/admin`)

```
✅ English interface (as requested)
✅ Content management
✅ Full CRUD operations
✅ Edit, Delete, View buttons working
```

---

## 🔧 **Common Issues & Solutions**

### **Issue 1: Port Already in Use**

**Error:**
```
Port 3000 is already in use
```

**Solution:**
Next.js will automatically use port 3002. Just use that URL.

Or kill the process:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Then start again
npm run dev
```

### **Issue 2: .next Folder Locked**

**Error:**
```
EPERM: operation not permitted, open '.next/trace'
```

**Solution:**
1. Close VS Code
2. Close all terminals
3. Open Task Manager (Ctrl + Shift + Esc)
4. End all `node.exe` processes
5. Delete `.next` folder manually
6. Run `start-server.bat` or `npm run dev`

### **Issue 3: Module Not Found**

**Error:**
```
Cannot find module 'xyz'
```

**Solution:**
```bash
cd C:\Users\rajes\techweb\Tamil-web
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### **Issue 4: Hot Reload Not Working**

**Solution:**
Restart the server:
- Press `Ctrl + C` in terminal
- Run `npm run dev` again

---

## 📊 **Server Logs**

### **Successful Start**

```
> poo-vaasam@0.1.0 dev
> next dev

   ▲ Next.js 15.5.15
   - Local:        http://localhost:3000
   - Network:      http://100.64.147.101:3000
   - Environments: .env.local

 ✓ Starting...
 ✓ Ready in 3.2s
 ○ Compiling / ...
 ✓ Compiled / in 2.5s
```

### **Compilation Logs**

```
 ○ Compiling /songs ...
 ✓ Compiled /songs in 1.8s

 ○ Compiling /poems ...
 ✓ Compiled /poems in 1.6s
```

---

## 🌐 **Remote Access (Optional)**

### **Access from Phone/Tablet on Same Network**

1. Find your computer's IP: `100.64.147.101`
2. On your phone/tablet, visit:
   ```
   http://100.64.147.101:3000
   ```

### **Access from Internet (Advanced)**

Use **ngrok** for temporary public URL:

```bash
# Install ngrok
npm install -g ngrok

# Start your server
npm run dev

# In another terminal
ngrok http 3000
```

You'll get a public URL like:
```
https://abc123.ngrok.io
```

---

## 📱 **Mobile Testing**

Your app is responsive! Test on:

- **Desktop**: Chrome, Firefox, Edge
- **Mobile**: iPhone Safari, Android Chrome
- **Tablet**: iPad Safari

---

## 💾 **Environment Variables**

Located at: `C:\Users\rajes\techweb\Tamil-web\.env.local`

```env
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_DYNAMODB_TABLE_NAME=TamilWebContent
NEXT_PUBLIC_S3_BUCKET=tamil-web-media
NEXT_PUBLIC_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key-id
AWS_SECRET_ACCESS_KEY=your-secret-key
```

**Never commit `.env.local` to Git!** ✅ Already in `.gitignore`

---

## 🎉 **Quick Start Checklist**

- [ ] Run `start-server.bat` or `npm run dev`
- [ ] Wait for "✓ Ready" message
- [ ] Open `http://localhost:3000` in browser
- [ ] Verify Tamil homepage loads
- [ ] Test navigation to `/songs` and `/poems`
- [ ] Test admin at `/admin`

---

## 📞 **Need Help?**

### **Server Won't Start**

1. Kill all Node processes
2. Delete `.next` folder
3. Run `npm install` again
4. Try `start-server.bat`

### **Tamil Text Not Showing**

1. Check browser console for font errors
2. Verify `font-tamil` class is applied
3. Check if Noto Sans Tamil font loaded

### **API Errors**

1. Check AWS credentials in `.env.local`
2. Verify DynamoDB table exists
3. Test API directly: `curl http://localhost:3000/api/test/content?action=stats`

---

**Project**: பூ வாசம் (Poo Vaasam)
**Status**: Production Ready ✅
**Tamil Interface**: 100% Complete ✅
**SEO Optimized**: Yes ✅

**Happy Coding!** 🚀
