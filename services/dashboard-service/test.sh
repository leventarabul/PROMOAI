#!/bin/bash
# Quick dashboard smoke test
BASE="http://localhost:3007"
echo "=== Dashboard Smoke Test ==="
echo ""

echo -n "1. Static HTML ........... "
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$BASE/")
if [ "$CODE" = "200" ]; then echo "✅ $CODE"; else echo "❌ $CODE"; fi

echo -n "2. GET /api/customers .... "
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$BASE/api/customers")
if [ "$CODE" = "200" ]; then echo "✅ $CODE"; else echo "❌ $CODE"; fi

echo -n "3. GET /api/campaigns .... "
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$BASE/api/campaigns")
if [ "$CODE" = "200" ]; then echo "✅ $CODE"; else echo "❌ $CODE"; fi

echo -n "4. GET /api/embeddings/stats "
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$BASE/api/embeddings/stats")
if [ "$CODE" = "200" ]; then echo "✅ $CODE"; else echo "❌ $CODE"; fi

echo -n "5. GET /api/contexts/active "
CODE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE/api/contexts/active")
if [ "$CODE" = "200" ]; then echo "✅ $CODE"; else echo "❌ $CODE"; fi

echo -n "6. GET /api/assignments/results "
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$BASE/api/assignments/results")
if [ "$CODE" = "200" ]; then echo "✅ $CODE"; else echo "❌ $CODE"; fi

echo -n "7. GET /api/embeddings/scatter "
CODE=$(curl -s -m 10 -o /dev/null -w "%{http_code}" "$BASE/api/embeddings/scatter")
if [ "$CODE" = "200" ]; then echo "✅ $CODE"; else echo "❌ $CODE"; fi

echo ""
echo "=== Done ==="
