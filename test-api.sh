#!/bin/bash
# API Testing Script for Poo Vaasam

echo "================================"
echo "🧪 Testing Poo Vaasam API"
echo "================================"
echo ""

BASE_URL="http://localhost:3000/api/test/content"

# Test 1: Get Statisticsecho "📊 Test 1: Get Statistics"
curl -s "$BASE_URL?action=stats" | python -m json.tool | head -15
echo ""
echo ""

# Test 2: List Categories
echo "📚 Test 2: List Categories"
curl -s "$BASE_URL?action=categories" | python -m json.tool | head -20
echo ""
echo ""

# Test 3: List Tags
echo "🏷️  Test 3: List Tags"
curl -s "$BASE_URL?action=tags" | python -m json.tool | head -15
echo ""
echo ""

# Test 4: List Content
echo "📄 Test 4: List All Content"
curl -s "$BASE_URL?action=list" | python -m json.tool | head -20
echo ""
echo ""

# Test 5: Get Songs
echo "🎵 Test 5: Filter by Type (SONGS)"
curl -s "$BASE_URL?action=by-type&type=SONGS" | python -m json.tool | head -15
echo ""
echo ""

echo "================================"
echo "✅ Testing Complete!"
echo "================================"
echo ""
echo "📊 Open in browser:"
echo "   http://localhost:3000/api/test/content?action=stats"
echo ""
