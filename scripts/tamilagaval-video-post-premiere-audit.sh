#!/usr/bin/env bash
#
# Generalized post-release audit for a YouTube video on the @tamilagaval channel.
#
# Usage: tamilagaval-video-post-premiere-audit.sh <VIDEO_ID>
#
# Invoked by per-video systemd oneshot services (e.g. tamilagaval-XEgb-audit.service)
# that hardcode the VIDEO_ID in their ExecStart line, so this script has zero
# per-video state. Self-discovers the release timestamp from the Data API
# (liveStreamingDetails.actualStartTime | scheduledStartTime | snippet.publishedAt).
#
# Pulls YouTube API credentials from SSM SecureString in ca-central-1 and writes
# a Markdown report to /home/devuser/reports/${VIDEO_ID}.post-premiere.md.
#
# Safe on partial upstream failures: uses `set +e` semantics around API calls
# so a single query error yields a partial report with an inline marker rather
# than aborting the whole audit. Always exits 0 so the systemd timer records
# success even when Google returns a transient 5xx.
#
# WHAT IT WON'T DO: revenue metrics have a 24-72h delay in the YouTube
# Analytics API, so the first-24h $ figures are preliminary. Re-run manually
# 3 days later for the settled numbers.

set -uo pipefail
umask 077

VIDEO_ID="${1:-}"
if [ -z "$VIDEO_ID" ]; then
  echo "usage: $0 <VIDEO_ID>" >&2
  exit 2
fi

APP_ID=d3rkmepk4popv0
BRANCH=master
REGION=ca-central-1
SSM_PREFIX="/amplify/${APP_ID}/${BRANCH}"

REPORT_DIR=/home/devuser/reports
REPORT_FILE="${REPORT_DIR}/${VIDEO_ID}.post-premiere.md"
LOG_TAG="tamilagaval-video-audit"

mkdir -p "$REPORT_DIR"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

log "start post-release audit for ${VIDEO_ID}"

# ---------------------------------------------------------------------------
# 1. Silently pull the credentials from SSM SecureString.
# ---------------------------------------------------------------------------
CLIENT_SECRET=$(aws --region "$REGION" ssm get-parameter --name "${SSM_PREFIX}/YOUTUBE_OAUTH_CLIENT_SECRET"    --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
READ_REFRESH=$(aws  --region "$REGION" ssm get-parameter --name "${SSM_PREFIX}/YOUTUBE_ANALYTICS_REFRESH_TOKEN" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
WRITE_REFRESH=$(aws --region "$REGION" ssm get-parameter --name "${SSM_PREFIX}/YOUTUBE_DATA_REFRESH_TOKEN"      --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
CLIENT_ID=$(aws     --region "$REGION" amplify get-app --app-id "$APP_ID" --query 'app.environmentVariables.YOUTUBE_OAUTH_CLIENT_ID' --output text 2>/dev/null)

if [ -z "$CLIENT_SECRET" ] || [ -z "$READ_REFRESH" ] || [ -z "$WRITE_REFRESH" ] || [ -z "$CLIENT_ID" ]; then
  log "FATAL: missing credentials from SSM/Amplify — aborting"
  echo "# Post-release audit — ${VIDEO_ID} — FAILED to load credentials" > "$REPORT_FILE"
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Refresh both OAuth access tokens.
# ---------------------------------------------------------------------------
refresh_token() {
  local rt="$1"
  curl -s -X POST https://oauth2.googleapis.com/token \
    --data-urlencode "client_id=${CLIENT_ID}" \
    --data-urlencode "client_secret=${CLIENT_SECRET}" \
    --data-urlencode "refresh_token=${rt}" \
    --data-urlencode 'grant_type=refresh_token' | jq -r '.access_token // empty'
}

READ_TOKEN=$(refresh_token "$READ_REFRESH")
WRITE_TOKEN=$(refresh_token "$WRITE_REFRESH")

if [ -z "$READ_TOKEN" ] || [ -z "$WRITE_TOKEN" ]; then
  log "FATAL: OAuth token refresh failed — aborting"
  echo "# Post-release audit — ${VIDEO_ID} — FAILED at OAuth token refresh" > "$REPORT_FILE"
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Fetch video metadata + guard for still-upcoming premiere.
# ---------------------------------------------------------------------------
META=$(curl -s "https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails,status,liveStreamingDetails&id=${VIDEO_ID}" \
  -H "Authorization: Bearer ${WRITE_TOKEN}")

if ! echo "$META" | jq -e '.items[0]' > /dev/null 2>&1; then
  log "FATAL: video ${VIDEO_ID} not found or inaccessible"
  echo "# Post-release audit — ${VIDEO_ID} — video not found (Data API returned no items)" > "$REPORT_FILE"
  exit 0
fi

LIVE_STATE=$(echo "$META" | jq -r '.items[0].snippet.liveBroadcastContent // "none"')
TITLE=$(echo "$META" | jq -r '.items[0].snippet.title // "(unknown)"')
DURATION=$(echo "$META" | jq -r '.items[0].contentDetails.duration // "unknown"')

# Self-discover release timestamp. Order: actual premiere start → scheduled premiere → publishedAt.
RELEASE_TS=$(echo "$META" | jq -r '.items[0].liveStreamingDetails.actualStartTime // .items[0].liveStreamingDetails.scheduledStartTime // .items[0].snippet.publishedAt // "unknown"')

# Data API v3 near-real-time public counters. Populated within minutes of the
# event (not the 24-48h Analytics-API window), so this section keeps the +24h
# report useful even when the Analytics tables are still all zero.
VIEWS_LIVE=$(echo "$META"    | jq -r '.items[0].statistics.viewCount    // "n/a"')
LIKES_LIVE=$(echo "$META"    | jq -r '.items[0].statistics.likeCount    // "n/a"')
COMMENTS_LIVE=$(echo "$META" | jq -r '.items[0].statistics.commentCount // "n/a"')

if [ "$LIVE_STATE" = "upcoming" ]; then
  log "video is still marked 'upcoming' — premiere did not fire on schedule"
  {
    echo "# Post-release audit — ${VIDEO_ID}"
    echo
    echo "**⚠️ The video is still marked \`liveBroadcastContent: upcoming\` as of $(date -u +%Y-%m-%dT%H:%M:%SZ).**"
    echo
    echo "Premiere did not fire on schedule, or was rescheduled to a later time. Re-run this audit manually once the premiere has completed."
    echo
    echo "Live-streaming details from API:"
    echo '```json'
    echo "$META" | jq '.items[0].liveStreamingDetails'
    echo '```'
  } > "$REPORT_FILE"
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Run all the analytics queries.
# ---------------------------------------------------------------------------
END=$(date -u +%Y-%m-%d)
START=$(date -u -d '3 days ago' +%Y-%m-%d)
D30_START=$(date -u -d '30 days ago' +%Y-%m-%d)

# a) first-24h totals for the video
TOTALS=$(curl -s "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate=${START}&endDate=${END}&filters=video%3D%3D${VIDEO_ID}&metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares,estimatedRevenue,adImpressions,cpm,playbackBasedCpm,monetizedPlaybacks" \
  -H "Authorization: Bearer ${READ_TOKEN}")

# b) retention curve
RETENTION=$(curl -s "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate=${START}&endDate=${END}&filters=video%3D%3D${VIDEO_ID}&dimensions=elapsedVideoTimeRatio&metrics=audienceWatchRatio,relativeRetentionPerformance&sort=elapsedVideoTimeRatio" \
  -H "Authorization: Bearer ${READ_TOKEN}")

# c) traffic sources
SOURCES=$(curl -s "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate=${START}&endDate=${END}&filters=video%3D%3D${VIDEO_ID}&dimensions=insightTrafficSourceType&metrics=views&sort=-views" \
  -H "Authorization: Bearer ${READ_TOKEN}")

# d) top 10 countries
GEO=$(curl -s "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate=${START}&endDate=${END}&filters=video%3D%3D${VIDEO_ID}&dimensions=country&metrics=views,estimatedMinutesWatched,averageViewDuration&sort=-views&maxResults=10" \
  -H "Authorization: Bearer ${READ_TOKEN}")

# e) 30-day channel median-per-video baseline
CHANNEL_30D=$(curl -s "https://youtubeanalytics.googleapis.com/v2/reports?ids=channel%3D%3DMINE&startDate=${D30_START}&endDate=${END}&dimensions=video&metrics=views&sort=-views&maxResults=200" \
  -H "Authorization: Bearer ${READ_TOKEN}")

# ---------------------------------------------------------------------------
# 5. Compose the Markdown report.
# ---------------------------------------------------------------------------
{
  echo "# Post-release audit — ${VIDEO_ID}"
  echo
  echo "**Title:** ${TITLE}"
  echo "**Duration:** ${DURATION}"
  echo "**Report generated:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "**Release timestamp:** ${RELEASE_TS} · **Audit window:** ${START} → ${END}"
  echo
  echo "## 1. Live snapshot (Data API v3, near-real-time)"
  echo
  echo "**Views:** ${VIEWS_LIVE} · **Likes:** ${LIKES_LIVE} · **Comments:** ${COMMENTS_LIVE}"
  echo
  echo "These are the public counters as of the report timestamp — no indexing"
  echo "lag. Use them as the honest first-day view; the Analytics-API sections"
  echo "below will show 0 for the first 24-48h until YouTube's reporting"
  echo "pipeline catches up. Compare Views here vs Section 2 to know whether a"
  echo "zero there is a data-lag artefact or genuinely low traffic."
  echo
  echo "## 2. First-24h scoreboard (Analytics API)"
  echo
  if echo "$TOTALS" | jq -e '.rows[0]' > /dev/null 2>&1; then
    echo '```json'
    echo "$TOTALS" | jq '{columns: [.columnHeaders[].name], values: .rows[0]}'
    echo '```'
    echo
    echo "> **Revenue caveat:** YouTube Analytics API revenue lags 24-72h. Numbers above are preliminary; re-run manually 3 days after release for the settled figures."
  else
    echo '_no rows returned — video may still be too fresh for analytics API, or upstream error_'
    echo '```json'
    echo "$TOTALS" | jq .
    echo '```'
  fi
  echo

  echo "## 3. Retention curve"
  echo
  if echo "$RETENTION" | jq -e '.rows[0]' > /dev/null 2>&1; then
    POINTS=$(echo "$RETENTION" | jq '.rows | length')
    echo "Sample points: **${POINTS}**"
    echo
    echo "Key milestones (t=% of video, audienceWatchRatio, relativeRetentionPerformance):"
    echo
    echo '```'
    echo "$RETENTION" | jq -r '.rows | .[range(0; length; (length/10 | floor // 1))] | [(.[0] * 100 | round | tostring + "%"), (.[1] * 100 | round | tostring + "%"), (.[2] * 100 | round | tostring + "%")] | @tsv' | column -t -s $'\t'
    echo '```'
  else
    echo '_no retention rows yet — usually available 24-48h after publish_'
  fi
  echo

  echo "## 4. Traffic sources (views)"
  echo
  if echo "$SOURCES" | jq -e '.rows[0]' > /dev/null 2>&1; then
    echo '| Source | Views |'
    echo '|---|---:|'
    echo "$SOURCES" | jq -r '.rows[] | "| \(.[0]) | \(.[1]) |"'
  else
    echo '_no traffic source data yet_'
  fi
  echo

  echo "## 5. Top 10 countries"
  echo
  if echo "$GEO" | jq -e '.rows[0]' > /dev/null 2>&1; then
    echo '| Country | Views | Watch minutes | Avg view duration (s) |'
    echo '|---|---:|---:|---:|'
    echo "$GEO" | jq -r '.rows[] | "| \(.[0]) | \(.[1]) | \(.[2]) | \(.[3]) |"'
  else
    echo '_no country data yet_'
  fi
  echo

  echo "## 6. Ranking vs 30-day channel"
  echo
  if echo "$CHANNEL_30D" | jq -e '.rows[0]' > /dev/null 2>&1; then
    RANK=$(echo "$CHANNEL_30D" | jq --arg vid "$VIDEO_ID" '[.rows | to_entries[] | select(.value[0] == $vid) | .key + 1][0] // "not in top 200"')
    MEDIAN=$(echo "$CHANNEL_30D" | jq '.rows | map(.[1]) | sort | .[length/2 | floor]')
    TOTAL=$(echo "$CHANNEL_30D" | jq '.rows | length')
    THIS_VIEWS=$(echo "$CHANNEL_30D" | jq --arg vid "$VIDEO_ID" '[.rows[] | select(.[0] == $vid) | .[1]][0] // 0')
    echo "- **This video's 30d rank:** ${RANK} of ${TOTAL} channel videos with views"
    echo "- **This video's views in the last 30d:** ${THIS_VIEWS}"
    echo "- **Channel median-per-video (30d):** ${MEDIAN}"
    echo
    echo "**Top 5 for context:**"
    echo '| # | Video | 30d views |'
    echo '|---|---|---:|'
    echo "$CHANNEL_30D" | jq -r '.rows[0:5] | to_entries[] | "| \(.key + 1) | \(.value[0]) | \(.value[1]) |"'
  else
    echo '_no 30d data available_'
  fi
  echo

  echo "## 7. Next actions"
  echo
  echo "Suggested follow-ups based on what the numbers actually show above:"
  echo
  echo "- [ ] If retention drops sharply in the first 15% (intro): iterate on the opening frame for the next release."
  echo "- [ ] If traffic-source is dominated by 'suggested video', that's algorithm pickup — good sign; if 'browse features' dominates, the thumbnail is doing the work."
  echo "- [ ] If India is <35% of views (vs channel avg 38%): the release is reaching outside the Indian Tamil segment — consider more Tamil-diaspora targeting for the next in this category."
  echo "- [ ] If RPM looks low, check the per-market baseline first (Tamil-India \$0.30-1.50 is normal); don't jump to Content ID unless YouTube Studio → Copyright tab confirms a claim. See feedback_rpm_not_content_id_by_default in memory."
  echo "- [ ] Re-run this script in +3 days for settled revenue figures: \`$0 ${VIDEO_ID}\`"
  echo
  echo "---"
  echo
  echo "_Generated by \`${LOG_TAG}\` for VIDEO_ID=${VIDEO_ID}._"
} > "$REPORT_FILE"

log "wrote report to $REPORT_FILE ($(wc -l < "$REPORT_FILE") lines)"

unset CLIENT_SECRET READ_REFRESH WRITE_REFRESH READ_TOKEN WRITE_TOKEN

exit 0
