#!/usr/bin/env bash
#
# Post a top-level channel comment on a YouTube video as @Tamilagaval.
#
# Usage: tamilagaval-post-pinned-comment.sh <VIDEO_ID> [--force]
#          (comment text read from stdin — pipe a heredoc or a file)
#
# Examples:
#   echo "your comment" | tamilagaval-post-pinned-comment.sh XYZ
#   tamilagaval-post-pinned-comment.sh XYZ < text-file
#   tamilagaval-post-pinned-comment.sh XYZ <<'EOF'
#   Your multi-line Tamil comment.
#   With emojis 💗🎶
#   EOF
#
# Refuses to post if @Tamilagaval already commented on the video (idempotency
# guard — prevents accidentally posting the same "pinned" comment twice on a
# re-run). Pass --force to override.
#
# What this script DOES NOT do: actually PIN the comment. The YouTube Data API
# has no pin endpoint. After this script prints the thread ID, open YouTube
# Studio → Content → your video → Comments → three-dot menu → Pin.
#
# Credentials come from SSM SecureString in ca-central-1 (same source as the
# post-release audit script). Both YOUTUBE_OAUTH_CLIENT_SECRET and
# YOUTUBE_DATA_REFRESH_TOKEN (force-ssl scope) must be populated.

set -uo pipefail
umask 077

VIDEO_ID="${1:-}"
FORCE=false
if [ "${2:-}" = "--force" ]; then FORCE=true; fi

if [ -z "$VIDEO_ID" ]; then
  echo "usage: $0 <VIDEO_ID> [--force]  (comment text on stdin)" >&2
  exit 2
fi

if [ -t 0 ]; then
  echo "error: comment text must be piped in on stdin" >&2
  echo "  echo 'your comment' | $0 $VIDEO_ID" >&2
  echo "  $0 $VIDEO_ID < text-file" >&2
  exit 2
fi

COMMENT_TEXT=$(cat)
if [ -z "$COMMENT_TEXT" ]; then
  echo "error: comment text is empty" >&2
  exit 2
fi

APP_ID=d3rkmepk4popv0
BRANCH=master
REGION=ca-central-1
SSM_PREFIX="/amplify/${APP_ID}/${BRANCH}"
CHANNEL_ID=UCZCuphXleq-mXVYgvqh-OlQ

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

log "start: post pinned comment for ${VIDEO_ID} (${#COMMENT_TEXT} chars)"

# ---------------------------------------------------------------------------
# 1. Silently pull credentials from SSM SecureString.
# ---------------------------------------------------------------------------
CLIENT_SECRET=$(aws --region "$REGION" ssm get-parameter --name "${SSM_PREFIX}/YOUTUBE_OAUTH_CLIENT_SECRET" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
WRITE_REFRESH=$(aws --region "$REGION" ssm get-parameter --name "${SSM_PREFIX}/YOUTUBE_DATA_REFRESH_TOKEN"      --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
CLIENT_ID=$(aws     --region "$REGION" amplify get-app --app-id "$APP_ID" --query 'app.environmentVariables.YOUTUBE_OAUTH_CLIENT_ID' --output text 2>/dev/null)

if [ -z "$CLIENT_SECRET" ] || [ -z "$WRITE_REFRESH" ] || [ -z "$CLIENT_ID" ]; then
  log "FATAL: missing credentials from SSM/Amplify — aborting"
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Refresh OAuth access token (Data API, force-ssl scope).
# ---------------------------------------------------------------------------
WRITE_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "refresh_token=${WRITE_REFRESH}" \
  --data-urlencode 'grant_type=refresh_token' | jq -r '.access_token // empty')

if [ -z "$WRITE_TOKEN" ]; then
  log "FATAL: OAuth token refresh failed"
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Verify the video exists + belongs to the @Tamilagaval channel.
# ---------------------------------------------------------------------------
META=$(curl -s "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${VIDEO_ID}" \
  -H "Authorization: Bearer ${WRITE_TOKEN}")

if ! echo "$META" | jq -e '.items[0]' > /dev/null 2>&1; then
  log "FATAL: video ${VIDEO_ID} not found or inaccessible"
  exit 1
fi

META_CHANNEL=$(echo "$META" | jq -r '.items[0].snippet.channelId')
if [ "$META_CHANNEL" != "$CHANNEL_ID" ]; then
  log "FATAL: video ${VIDEO_ID} belongs to channel ${META_CHANNEL}, not ${CHANNEL_ID}"
  exit 1
fi

TITLE=$(echo "$META" | jq -r '.items[0].snippet.title')
log "target: ${TITLE}"

# ---------------------------------------------------------------------------
# 4. Idempotency guard — refuse to post if channel already has a comment,
#    unless --force is passed.
# ---------------------------------------------------------------------------
if [ "$FORCE" != true ]; then
  # Ordered by relevance so a pinned comment surfaces at position 0.
  EXISTING=$(curl -s "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${VIDEO_ID}&order=relevance&maxResults=10" \
    -H "Authorization: Bearer ${WRITE_TOKEN}" \
    | jq --arg ch "$CHANNEL_ID" '[.items[] | select(.snippet.topLevelComment.snippet.authorChannelId.value == $ch)] | length')

  if [ "${EXISTING:-0}" -gt 0 ]; then
    log "ABORT: channel already has a comment on ${VIDEO_ID} (pass --force to add another)"
    exit 3
  fi
fi

# ---------------------------------------------------------------------------
# 5. Build the request body with jq (safe UTF-8 / quote / newline escaping)
#    and POST commentThreads.insert.
# ---------------------------------------------------------------------------
BODY=$(jq -n \
  --arg channel "$CHANNEL_ID" \
  --arg video "$VIDEO_ID" \
  --arg text "$COMMENT_TEXT" \
  '{snippet: {channelId: $channel, videoId: $video, topLevelComment: {snippet: {textOriginal: $text}}}}')

RESP=$(curl -s -X POST "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet" \
  -H "Authorization: Bearer ${WRITE_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$BODY")

COMMENT_ID=$(echo "$RESP" | jq -r '.id // empty')
if [ -z "$COMMENT_ID" ]; then
  log "FAILED: $(echo "$RESP" | jq -r '.error.message // "unknown error"')"
  echo "$RESP" | jq . >&2
  exit 1
fi

PUBLISHED=$(echo "$RESP" | jq -r '.snippet.topLevelComment.snippet.publishedAt')

log "SUCCESS thread_id=${COMMENT_ID} at ${PUBLISHED}"
echo
echo "Next: pin manually in YouTube Studio (no API for pin)."
echo "  Studio → Content → ${VIDEO_ID} → Comments → three-dot → Pin"

unset CLIENT_SECRET WRITE_REFRESH WRITE_TOKEN
exit 0
