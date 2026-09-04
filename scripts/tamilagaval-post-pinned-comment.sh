#!/usr/bin/env bash
#
# Post a top-level channel comment on a YouTube video as @Tamilagaval.
#
# Usage: tamilagaval-post-pinned-comment.sh <VIDEO_ID> [--force] [--dry-run]
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
# ALSO refuses to post before a premiere has actually started. This is NOT
# overridable by --force, on purpose. Twice — HOZ3FGrI2xk (2026-08-28, 7h30m
# early) and Vu1pcY7cp8M (2026-08-31, 2d 7h52m early) — the comment was posted
# by hand while the video was still `upcoming`, which meant the scheduled
# systemd run later aborted on the idempotency guard above. The automation had
# therefore never once posted a comment: 0 for 2. Use --dry-run to preview the
# text without posting; that is the mode you actually want during setup.
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

# ---------------------------------------------------------------------------
# 0. Pure helpers. Sourcing this file with TAMILAGAVAL_LIB_ONLY=1 defines them
#    and returns immediately, so they can be unit-tested with no credentials
#    and no side effects. See scripts/test-pinned-comment-guard.sh.
# ---------------------------------------------------------------------------

# premiere_has_started <liveStreamingDetails-json | ABSENT>
#   exit 0 => safe to post   exit 1 => refuse
#
# The decisive field is actualStartTime, NOT snippet.liveBroadcastContent.
# The timer deliberately fires ~6 minutes after the premiere STARTS, while the
# broadcast is still live (Vu1p: fired 12:21:10, actualEndTime 12:22:54), so
# gating on liveBroadcastContent=="none" would refuse the real, intended run.
# Anything unparseable fails closed — refusing a valid post is recoverable,
# posting days early is not.
premiere_has_started() {
  local lsd="${1-}" actual
  case "$lsd" in
    ABSENT|null|'{}') return 0 ;;   # ordinary upload, never a premiere
  esac
  [ -z "$lsd" ] && return 1
  echo "$lsd" | jq -e . >/dev/null 2>&1 || return 1
  actual=$(echo "$lsd" | jq -r '.actualStartTime // empty' 2>/dev/null)
  [ -n "$actual" ] && return 0
  return 1
}

if [ -n "${TAMILAGAVAL_LIB_ONLY:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

VIDEO_ID="${1:-}"
[ $# -gt 0 ] && shift
FORCE=false
DRY_RUN=false
while [ $# -gt 0 ]; do
  case "$1" in
    --force)   FORCE=true ;;
    --dry-run) DRY_RUN=true ;;
    *) echo "error: unknown option '$1'" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$VIDEO_ID" ]; then
  echo "usage: $0 <VIDEO_ID> [--force] [--dry-run]  (comment text on stdin)" >&2
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
META=$(curl -s "https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${VIDEO_ID}" \
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
# 3b. Premiere pre-flight — never post before the premiere has actually begun.
#     Deliberately NOT overridable by --force: an operator who hits an
#     unexpected abort mid-recipe will reach for the documented override, and
#     that is exactly how this bug was created twice.
# ---------------------------------------------------------------------------
if echo "$META" | jq -e '.items[0] | has("liveStreamingDetails")' >/dev/null 2>&1; then
  LSD=$(echo "$META" | jq -c '.items[0].liveStreamingDetails')
else
  LSD=ABSENT
fi

if ! premiere_has_started "$LSD"; then
  SCHED=$(echo "$LSD" | jq -r '.scheduledStartTime // "unknown"' 2>/dev/null)
  log "ABORT: premiere for ${VIDEO_ID} has not started yet (scheduled: ${SCHED})"
  log "       Posting now would put the comment on the video before the audience"
  log "       arrives, and the scheduled systemd run would then no-op on the"
  log "       idempotency guard — which is how HOZ3FGrI2xk and Vu1pcY7cp8M both"
  log "       ended up with hand-posted comments and a never-fired automation."
  log "       Let the timer fire. To review the text now, re-run with --dry-run."
  log "       (--force does NOT override this check.)"
  exit 4
fi

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

if [ "$DRY_RUN" = true ]; then
  log "DRY RUN — every pre-flight check passed; nothing was posted."
  echo
  echo "--- comment that WOULD be posted on ${VIDEO_ID} (${#COMMENT_TEXT} chars) ---"
  printf '%s\n' "$COMMENT_TEXT"
  echo "--- end ---"
  unset CLIENT_SECRET WRITE_REFRESH WRITE_TOKEN
  exit 0
fi

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
