# API Testing Script for Poo Vaasam
# Run this in PowerShell to test all endpoints

Write-Host "🧪 Testing Poo Vaasam API" -ForegroundColor Green
Write-Host "================================`n" -ForegroundColor Green

$baseUrl = "http://localhost:3000/api/test/content"

# Test 1: Get Statistics
Write-Host "📊 Test 1: Get Statistics" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl?action=stats" -Method Get
    Write-Host "✅ Success! Found:" -ForegroundColor Green
    Write-Host "   - Songs: $($response.data.songs)" -ForegroundColor Yellow
    Write-Host "   - Poems: $($response.data.poems)" -ForegroundColor Yellow
    Write-Host "   - Published: $($response.data.published)" -ForegroundColor Yellow
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 2: List Categories
Write-Host "📚 Test 2: List Categories" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl?action=categories" -Method Get
    Write-Host "✅ Success! Found $($response.data.Count) categories:" -ForegroundColor Green
    foreach ($cat in $response.data) {
        Write-Host "   - $($cat.name) (slug: $($cat.slug), count: $($cat.contentCount))" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 3: List Tags
Write-Host "🏷️  Test 3: List Tags" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl?action=tags" -Method Get
    Write-Host "✅ Success! Found $($response.data.Count) tags:" -ForegroundColor Green
    foreach ($tag in $response.data) {
        Write-Host "   - $($tag.name) (slug: $($tag.slug))" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 4: List Content
Write-Host "📄 Test 4: List All Content" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl?action=list" -Method Get
    Write-Host "✅ Success! Found $($response.data.total) content items:" -ForegroundColor Green
    foreach ($content in $response.data.items) {
        Write-Host "   - $($content._title) by $($content._author)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 5: Get Content by Type
Write-Host "🎵 Test 5: Get Songs" -ForegroundColor Cyan
try {
    $response = Invoke-RestMethod -Uri "$baseUrl?action=by-type&type=SONGS" -Method Get
    Write-Host "✅ Success! Found $($response.data.total) songs" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 6: Create New Content
Write-Host "✍️  Test 6: Create New Poem" -ForegroundColor Cyan
try {
    $body = @{
        action = "create-content"
        type = "POEMS"
        title = "தமிழ் தாய்"
        body = "நீத்த சிங்கம் ஒன்று கண்டேன்`nதீத்திருக்கும் வீரம் கண்டேன்"
        description = "பாரதியார் கவிதை"
        author = "பாரதியார்"
        status = "PUBLISHED"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri $baseUrl -Method Post -Body $body -ContentType "application/json"
    Write-Host "✅ Success! Created content with ID: $($response.data.id)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 7: Create New Category
Write-Host "📁 Test 7: Create New Category" -ForegroundColor Cyan
try {
    $body = @{
        action = "create-category"
        name = "நாட்டுப்புற பாடல்கள்"
        description = "தமிழ் நாட்டுப்புற பாடல்களின் தொகுப்பு"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri $baseUrl -Method Post -Body $body -ContentType "application/json"
    Write-Host "✅ Success! Created category: $($response.data.name)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 8: Create New Tag
Write-Host "🏷️  Test 8: Create New Tag" -ForegroundColor Cyan
try {
    $body = @{
        action = "create-tag"
        name = "பக்தி"
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri $baseUrl -Method Post -Body $body -ContentType "application/json"
    Write-Host "✅ Success! Created tag: $($response.data.name)" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

Write-Host "================================" -ForegroundColor Green
Write-Host "🎉 Testing Complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 View in browser:" -ForegroundColor Cyan
Write-Host "   http://localhost:3000/api/test/content?action=stats" -ForegroundColor Yellow
Write-Host ""
