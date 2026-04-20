# API Testing Guide - Poo Vaasam

Complete guide to testing your Tamil content publishing platform API.

## 🚀 Quick Start

### 1. Start Development Server

```bash
npm run dev
```

Server will start at: `http://localhost:3000`

---

## 📋 Test API Endpoints

Base URL: `http://localhost:3000/api/test/content`

---

### 🌱 Step 1: Seed Database with Tamil Test Data

**POST** `/api/test/content`

```bash
curl -X POST http://localhost:3000/api/test/content \
  -H "Content-Type: application/json" \
  -d '{"action": "seed"}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "categories": 3,
    "tags": 3,
    "content": 1,
    "sampleContentId": "cnt_1234..."
  },
  "message": "Successfully seeded database"
}
```

**What it creates:**
- 3 Categories: தமிழ் பாடல்கள், கவிதைகள், கதைகள்
- 3 Tags: காதல், இயற்கை, வாழ்க்கை
- 1 Sample Song: "பூ வாசம்"

---

### 📊 Step 2: Get Statistics

**GET** `/api/test/content?action=stats`

```bash
curl http://localhost:3000/api/test/content?action=stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "songs": 1,
    "poems": 0,
    "lyrics": 0,
    "stories": 0,
    "essays": 0,
    "published": 1,
    "draft": 0,
    "mostViewed": [],
    "recentlyPublished": [...]
  }
}
```

---

### 📝 Step 3: List All Categories

**GET** `/api/test/content?action=categories`

```bash
curl http://localhost:3000/api/test/content?action=categories
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "cat_...",
      "name": "தமிழ் பாடல்கள்",
      "slug": "tamil-songs",
      "description": "தமிழ் திரைப்பட பாடல்கள்",
      "contentCount": 1,
      "createdAt": "2026-04-20T..."
    },
    ...
  ]
}
```

---

### 🏷️ Step 4: List All Tags

**GET** `/api/test/content?action=tags`

```bash
curl http://localhost:3000/api/test/content?action=tags
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "tag_...",
      "name": "காதல்",
      "slug": "love",
      "contentCount": 1,
      "createdAt": "2026-04-20T..."
    },
    ...
  ]
}
```

---

### 📄 Step 5: List All Content

**GET** `/api/test/content?action=list`

```bash
curl http://localhost:3000/api/test/content?action=list
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "cnt_...",
        "type": "SONGS",
        "title": "பூ வாசம்",
        "titleSlug": "பூ-வாசம்",
        "body": "பூ வாசம் வந்து என்னை கவர்ந்ததடி...",
        "author": "இளையராஜா",
        "status": "PUBLISHED",
        ...
      }
    ],
    "total": 1,
    "limit": 10,
    "offset": 0,
    "hasMore": false
  }
}
```

---

### 🔍 Step 6: Get Content by ID

**GET** `/api/test/content?id={contentId}`

```bash
# Use the sampleContentId from step 1
curl http://localhost:3000/api/test/content?id=cnt_1234567890_abc123
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "cnt_...",
    "title": "பூ வாசம்",
    "body": "...",
    "categories": [
      {
        "id": "cat_...",
        "name": "தமிழ் பாடல்கள்",
        ...
      }
    ],
    "tags": [
      {
        "id": "tag_...",
        "name": "காதல்",
        ...
      }
    ]
  }
}
```

---

### 🎵 Step 7: Filter Content by Type

**GET** `/api/test/content?action=by-type&type=SONGS`

```bash
curl http://localhost:3000/api/test/content?action=by-type&type=SONGS
```

**Available Types:**
- `SONGS`
- `POEMS`
- `LYRICS`
- `STORIES`
- `ESSAYS`

---

### ✍️ Step 8: Create New Content

**POST** `/api/test/content`

```bash
curl -X POST http://localhost:3000/api/test/content \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create-content",
    "type": "POEMS",
    "title": "தமிழ் தாய்",
    "body": "நீத்த சிங்கம்...",
    "description": "பாரதியார் கவிதை",
    "author": "பாரதியார்",
    "status": "PUBLISHED"
  }'
```

---

### 📚 Step 9: Create New Category

**POST** `/api/test/content`

```bash
curl -X POST http://localhost:3000/api/test/content \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create-category",
    "name": "நாட்டுப்புற பாடல்கள்",
    "description": "தமிழ் நாட்டுப்புற பாடல்களின் தொகுப்பு"
  }'
```

---

### 🏷️ Step 10: Create New Tag

**POST** `/api/test/content`

```bash
curl -X POST http://localhost:3000/api/test/content \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create-tag",
    "name": "பக்தி"
  }'
```

---

## 🧪 Testing with Postman

### Import Collection

1. Open Postman
2. Create new collection: "Poo Vaasam API"
3. Add requests from above examples
4. Set base URL variable: `http://localhost:3000`

### Sample Postman Tests

```javascript
// Test: Seed Database
pm.test("Status code is 201", function () {
    pm.response.to.have.status(201);
});

pm.test("Categories created", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.data.categories).to.equal(3);
});

// Save content ID for later use
pm.environment.set("contentId", pm.response.json().data.sampleContentId);
```

---

## 🔬 Testing with VS Code REST Client

Create a file `test-api.http`:

```http
### Seed Database
POST http://localhost:3000/api/test/content
Content-Type: application/json

{
  "action": "seed"
}

### Get Statistics
GET http://localhost:3000/api/test/content?action=stats

### List Categories
GET http://localhost:3000/api/test/content?action=categories

### List Tags
GET http://localhost:3000/api/test/content?action=tags

### List Content
GET http://localhost:3000/api/test/content?action=list

### Get Content by ID
GET http://localhost:3000/api/test/content?id=cnt_1713617890_abc123

### Create New Content
POST http://localhost:3000/api/test/content
Content-Type: application/json

{
  "action": "create-content",
  "type": "POEMS",
  "title": "காற்று",
  "body": "காற்று வீசுதடி காற்று வீசுதடி",
  "description": "இயற்கையைப் பற்றிய கவிதை",
  "author": "பாரதியார்",
  "status": "PUBLISHED"
}
```

---

## 🐛 Troubleshooting

### Error: "Table TamilWebContent not found"

**Solution:** Create DynamoDB table first

```bash
npm run aws:dynamodb
```

### Error: "Bucket tamil-web-media not found"

**Solution:** Create S3 bucket first

```bash
npm run aws:s3
```

### Error: "Access Denied"

**Solution:** Check AWS credentials in `.env.local`

```bash
# Ensure these are set:
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
NEXT_PUBLIC_AWS_REGION=us-east-1
```

### Error: "Invalid credentials"

**Solution:** Verify IAM user has correct policies attached
- See `docs/AWS_POLICIES.md`
- Ensure DynamoDB and S3 policies are attached

---

## ✅ Expected Test Results

After running all tests, you should have:

1. **3 Categories** in DynamoDB
   - தமிழ் பாடல்கள் (Tamil Songs)
   - கவிதைகள் (Poems)
   - கதைகள் (Stories)

2. **3 Tags** in DynamoDB
   - காதல் (Love)
   - இயற்கை (Nature)
   - வாழ்க்கை (Life)

3. **1+ Content Items** in DynamoDB
   - பூ வாசம் (Sample Song)
   - Any additional content you created

4. **Working Relationships**
   - Content linked to categories
   - Content linked to tags
   - Category counts updated
   - Tag counts updated

---

## 📊 Verify in AWS Console

### DynamoDB

1. Go to AWS Console → DynamoDB
2. Select `TamilWebContent` table
3. Click "Explore table items"
4. You should see items with:
   - `PK` starting with `CONTENT#`, `CATEGORY#`, `TAG#`
   - Tamil text in `name`, `title`, `body` fields

### S3 (for future media uploads)

1. Go to AWS Console → S3
2. Select `tamil-web-media` bucket
3. Should have folders: `/audio`, `/images`, `/temp`

---

## 🎯 Next Steps

After verifying the API works:

1. **Build Admin UI** - Use these endpoints to create admin forms
2. **Add Authentication** - Protect create/update/delete endpoints
3. **Build Public Pages** - Display content on frontend
4. **Add Media Uploads** - Implement image and audio uploads
5. **Add Search** - Enhance search with OpenSearch/Algolia

---

## 📚 API Reference Summary

| Method | Endpoint | Action | Purpose |
|--------|----------|--------|---------|
| POST | `/api/test/content` | seed | Seed database with Tamil data |
| GET | `/api/test/content` | stats | Get repository statistics |
| GET | `/api/test/content` | categories | List all categories |
| GET | `/api/test/content` | tags | List all tags |
| GET | `/api/test/content` | list | List all content |
| GET | `/api/test/content?id=xxx` | - | Get content by ID |
| GET | `/api/test/content?slug=xxx` | - | Get content by slug |
| GET | `/api/test/content?action=by-type&type=SONGS` | by-type | Filter by content type |
| POST | `/api/test/content` | create-content | Create new content |
| POST | `/api/test/content` | create-category | Create new category |
| POST | `/api/test/content` | create-tag | Create new tag |

---

## 🎉 Success Indicators

✅ Dev server starts without errors
✅ Seed endpoint creates Tamil test data
✅ Statistics show content counts
✅ Categories list shows Tamil names
✅ Tags list shows Tamil names
✅ Content list shows Tamil text
✅ Get by ID returns content with relations
✅ DynamoDB console shows Tamil data
✅ All responses are type-safe

**Your data layer is fully functional!** 🚀
