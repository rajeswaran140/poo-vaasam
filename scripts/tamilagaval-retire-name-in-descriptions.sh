#!/usr/bin/env bash
#
# Finish the 2026 rebrand in YouTube DESCRIPTIONS.
#
#   scripts/tamilagaval-retire-name-in-descriptions.sh            # dry run
#   scripts/tamilagaval-retire-name-in-descriptions.sh --commit   # apply
#
# Replaces the construct   Raj (Rajeswaran Thangarajah)
# with                     Raj Thangarajah
#
# WHY A CONSTRUCT AND NOT THE BARE NAME. The parenthetical existed to expand
# "Raj" to the full legal name. Swapping only the name yields "Raj (Raj
# Thangarajah)", which is redundant. Replacing the whole construct keeps the
# surname — and its search value — without the retired first name. Raj chose
# this wording on 2026-09-05.
#
# WHY DESCRIPTIONS ONLY. A catalogue scan on 2026-09-05 found the retired name
# on 99 of 111 videos, all of them in the description; tags and titles are
# already clean, so the 2026-07-31 sweep succeeded there. See RETIRED_NAME in
# src/lib/release-checklist.ts for the history.
#
# ⚠️ WRITES TO PUBLIC METADATA. Dry run is the default and prints a full diff.
# --commit backs every snippet up to reports/ FIRST, then writes, then RE-READS
# each video to confirm the change actually landed — the API's 200 is not
# evidence (see the "Publishing traps" admin doc).
#
# ⚠️ QUOTA. videos.update costs 50 units per call; 99 videos is ~4,950 units
# against a 10,000/day default. Do not run this twice in one day.
#
# Idempotent: a video whose description no longer matches is skipped.

set -uo pipefail
umask 077

COMMIT=false
[ "${1:-}" = "--commit" ] && COMMIT=true

APP_ID=d3rkmepk4popv0
BRANCH=master
REGION=ca-central-1
SSM_PREFIX="/amplify/${APP_ID}/${BRANCH}"
UPLOADS=UUZCuphXleq-mXVYgvqh-OlQ
CHANNEL_ID=UCZCuphXleq-mXVYgvqh-OlQ

OLD='Raj (Rajeswaran Thangarajah)'
NEW='Raj Thangarajah'

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR=/home/devuser/reports
BACKUP="${OUT_DIR}/retire-name-backup-${STAMP}.jsonl"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

CLIENT_SECRET=$(aws --region "$REGION" ssm get-parameter --name "${SSM_PREFIX}/YOUTUBE_OAUTH_CLIENT_SECRET" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
WRITE_REFRESH=$(aws --region "$REGION" ssm get-parameter --name "${SSM_PREFIX}/YOUTUBE_DATA_REFRESH_TOKEN" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null)
CLIENT_ID=$(aws --region "$REGION" amplify get-app --app-id "$APP_ID" --query 'app.environmentVariables.YOUTUBE_OAUTH_CLIENT_ID' --output text 2>/dev/null)
if [ -z "$CLIENT_SECRET" ] || [ -z "$WRITE_REFRESH" ] || [ -z "$CLIENT_ID" ]; then
  log "FATAL: missing credentials from SSM/Amplify"; exit 1
fi
TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "client_secret=${CLIENT_SECRET}" \
  --data-urlencode "refresh_token=${WRITE_REFRESH}" \
  --data-urlencode 'grant_type=refresh_token' | jq -r '.access_token // empty')
[ -z "$TOKEN" ] && { log "FATAL: OAuth token refresh failed"; exit 1; }

# --- collect every upload ----------------------------------------------------
IDS=(); PAGE=""
while :; do
  U="https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${UPLOADS}&maxResults=50"
  [ -n "$PAGE" ] && U="${U}&pageToken=${PAGE}"
  R=$(curl -s "$U" -H "Authorization: Bearer ${TOKEN}")
  while read -r id; do [ -n "$id" ] && IDS+=("$id"); done < <(echo "$R" | jq -r '.items[].contentDetails.videoId')
  PAGE=$(echo "$R" | jq -r '.nextPageToken // empty'); [ -z "$PAGE" ] && break
done
log "catalogue: ${#IDS[@]} videos"

$COMMIT && : > "$BACKUP"

TOTAL=0; CHANGED=0; SKIPPED=0; FAILED=0; RESIDUAL=0

for ((i=0; i<${#IDS[@]}; i+=50)); do
  CHUNK=$(IFS=,; echo "${IDS[*]:i:50}")
  BATCH=$(curl -s "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${CHUNK}&maxResults=50" \
    -H "Authorization: Bearer ${TOKEN}")

  while IFS= read -r item; do
    [ -z "$item" ] && continue
    TOTAL=$((TOTAL+1))
    VID=$(echo "$item" | jq -r '.id')
    DESC=$(echo "$item" | jq -r '.snippet.description // ""')
    case "$DESC" in
      *"$OLD"*) ;;
      *) SKIPPED=$((SKIPPED+1)); continue ;;
    esac

    NEWDESC=${DESC//"$OLD"/"$NEW"}
    CHANGED=$((CHANGED+1))

    if ! $COMMIT; then
      if [ "$CHANGED" -le 3 ]; then
        echo "--- $VID ---"
        echo "$DESC"     | grep -n -i 'rajeswaran' | sed 's/^/  BEFORE /'
        echo "$NEWDESC"  | grep -n -i 'thangarajah' | sed 's/^/  AFTER  /'
      fi
      # Anything still carrying the retired name after the swap is reported.
      echo "$NEWDESC" | grep -qi 'rajeswaran' && { RESIDUAL=$((RESIDUAL+1)); echo "  ⚠️  $VID still contains 'rajeswaran' after the swap"; }
      continue
    fi

    echo "$item" | jq -c '{id, snippet}' >> "$BACKUP"

    # Send the writable snippet fields. title + categoryId are REQUIRED on a
    # snippet update; omitting tags/languages would clear them.
    BODY=$(echo "$item" | jq -c --arg d "$NEWDESC" '{
      id: .id,
      snippet: ({
        title: .snippet.title,
        categoryId: .snippet.categoryId,
        description: $d
      }
      + (if .snippet.tags then {tags: .snippet.tags} else {} end)
      + (if .snippet.defaultLanguage then {defaultLanguage: .snippet.defaultLanguage} else {} end)
      + (if .snippet.defaultAudioLanguage then {defaultAudioLanguage: .snippet.defaultAudioLanguage} else {} end))
    }')

    RESP=$(curl -s -X PUT "https://www.googleapis.com/youtube/v3/videos?part=snippet" \
      -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" --data "$BODY")
    if [ -z "$(echo "$RESP" | jq -r '.id // empty')" ]; then
      FAILED=$((FAILED+1))
      log "FAILED ${VID}: $(echo "$RESP" | jq -r '.error.message // "unknown"')"
      continue
    fi

    # Verify the write by re-reading — a 200 is not evidence the field changed.
    #
    # Measured 2026-09-05: reads are eventually consistent. A 0.3s check
    # reported 75 of 100 as unchanged when only ONE actually was, and that one
    # briefly read clean before reverting — replicas disagree in both
    # directions. So: wait, then retry before believing a negative.
    #
    # The retry earns its keep. On the first run wPxNf0VKUKQ returned a 200
    # with an id and did NOT persist; the write had to be reissued. A 200 from
    # this endpoint is genuinely not evidence.
    VERIFIED=false
    for attempt in 1 2 3; do
      sleep $((attempt * 2))
      CHECK=$(curl -s "https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${VID}" \
        -H "Authorization: Bearer ${TOKEN}" | jq -r '.items[0].snippet.description // ""')
      if ! echo "$CHECK" | grep -qi 'rajeswaran'; then VERIFIED=true; break; fi
    done
    if $VERIFIED; then
      log "ok ${VID}"
    else
      RESIDUAL=$((RESIDUAL+1))
      log "⚠️  ${VID} still shows the retired name after 3 checks — re-run to reissue"
    fi
  done < <(echo "$BATCH" | jq -c '.items[]')
done

echo
echo "================ SUMMARY ================"
echo "mode            : $($COMMIT && echo APPLIED || echo 'DRY RUN — nothing written')"
echo "videos examined : $TOTAL"
echo "would change    : $CHANGED"
echo "already clean   : $SKIPPED"
$COMMIT && echo "failed          : $FAILED"
echo "residual name   : $RESIDUAL"
$COMMIT && echo "backup          : $BACKUP"
$COMMIT || echo "(re-run with --commit to apply)"

unset CLIENT_SECRET WRITE_REFRESH TOKEN
exit 0
