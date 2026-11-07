#!/usr/bin/env bash
#
# ONE-TIME SETUP for the Video Text tool (2026-11-07).
#
# Long text-over-video renders are cut into chunks that run in parallel. Each
# chunk is one synchronous invocation of `tamilagaval-video-text-chunk` — the
# SAME bundle as the master-worker (its handler refuses any non-chunk event when
# AWS_LAMBDA_FUNCTION_NAME is tamilagaval-video-text-chunk), its own function so
# 20 chunks at a time do not compete with the master-worker's reserved 3.
#
# What this does, in order:
#   1. creates tamilagaval-video-text-chunk from master-worker.zip (build it
#      first: npm run build:master-worker && zip), same role and ffmpeg layer,
#      3008 MB / 300 s / 2 GB scratch, env TAKES_BUCKET + TAKES_BUCKET_REGION;
#   2. reserves 20 concurrent executions for it;
#   3. lets the shared worker role invoke it (inline policy
#      invoke-video-text-chunk) — the master-worker calls it synchronously;
#   4. adds the S3 lifecycle rule video-text-30d on tamil-web-media
#      (audio/mastering/video-text/ expires after 30 days). The bucket may
#      already carry other rules, so this MERGES: it reads the current
#      configuration, replaces/appends only video-text-30d, and puts the result.
#
# After this, `npm run deploy:master-worker` updates all three functions' code.
#
# The bucket is VERSIONED, so Expiration alone only adds a delete marker. The
# rule therefore also expires noncurrent versions after 1 day, and a second rule
# (video-text-markers) removes the leftover delete markers.
#
# USAGE:  ./scripts/setup-video-text.sh                       # apply
#         ./scripts/setup-video-text.sh --dry                 # print the write commands only
#                                                             # (read-only AWS calls still run)
#         ./scripts/setup-video-text.sh --remove-lifecycle    # rollback: drop only our two
#                                                             # lifecycle rules (steps 1-3 untouched)
#         add --dry to --remove-lifecycle to preview it
set -euo pipefail

REGION="${AWS_REGION:-ca-central-1}"
ACCOUNT="975050319109"
FN="tamilagaval-video-text-chunk"
ROLE="tamilagaval-compose-worker-role"
LAYER="arn:aws:lambda:${REGION}:${ACCOUNT}:layer:tamilagaval-ffmpeg:1"
ZIP="master-worker.zip"
BUCKET="tamil-web-media"
BUCKET_REGION="us-east-1"
RULE_ID="video-text-30d"
MARKER_ID="video-text-markers"
RULE_PREFIX="audio/mastering/video-text/"
run() { if [ "${1:-}" = "--dry" ]; then shift; echo "+ $*"; else shift; "$@"; fi; }
DRY=""; REMOVE=0
for arg in "$@"; do
  case "$arg" in
    --dry) DRY="--dry" ;;
    --remove-lifecycle) REMOVE=1 ;;
    *) echo "unknown argument: $arg" >&2
       echo "usage: $0 [--dry] [--remove-lifecycle]" >&2; exit 2 ;;
  esac
done

if [ "$REMOVE" = 0 ]; then
[ -f "$ZIP" ] || { echo "Build $ZIP first: npm run build:master-worker && (cd master-worker-dist && zip -q -r ../$ZIP index.js)"; exit 1; }

echo "=== 1. create $FN ==="
CONFIG=(--runtime nodejs20.x --handler index.handler
  --role "arn:aws:iam::${ACCOUNT}:role/${ROLE}"
  --layers "$LAYER"
  --memory-size 3008 --timeout 300 --ephemeral-storage Size=2048
  --environment "Variables={TAKES_BUCKET=${BUCKET},TAKES_BUCKET_REGION=${BUCKET_REGION}}")
if aws --region "$REGION" lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  echo "  exists — bringing its code and settings up to date"
  run "$DRY" aws --region "$REGION" lambda update-function-code --function-name "$FN" --zip-file "fileb://$ZIP" --query LastModified --output text
  run "$DRY" aws --region "$REGION" lambda wait function-updated --function-name "$FN"
  run "$DRY" aws --region "$REGION" lambda update-function-configuration --function-name "$FN" "${CONFIG[@]}" --query LastModified --output text
  run "$DRY" aws --region "$REGION" lambda wait function-updated --function-name "$FN"
else
  run "$DRY" aws --region "$REGION" lambda create-function --function-name "$FN" --architectures x86_64 \
    "${CONFIG[@]}" --zip-file "fileb://$ZIP" --query FunctionArn --output text
  run "$DRY" aws --region "$REGION" lambda wait function-active-v2 --function-name "$FN"
fi

echo "=== 2. reserve 20 concurrent ==="
CURRENT_RES=$(aws --region "$REGION" lambda get-function-concurrency --function-name "$FN" \
  --query ReservedConcurrentExecutions --output text 2>/dev/null || echo None)
if [ "$CURRENT_RES" = "20" ]; then
  echo "  already reserved at 20 — skipping"
else
  # AWS refuses a reservation that leaves the account under 100 unreserved.
  UNRESERVED=$(aws --region "$REGION" lambda get-account-settings --query AccountLimit.UnreservedConcurrentExecutions --output text)
  echo "  unreserved now: $UNRESERVED"
  if [ "$UNRESERVED" -lt 120 ]; then echo "  too few unreserved executions to reserve 20 — stopping"; exit 1; fi
  run "$DRY" aws --region "$REGION" lambda put-function-concurrency --function-name "$FN" \
    --reserved-concurrent-executions 20 --query ReservedConcurrentExecutions --output text
fi

echo "=== 3. allow the worker role to invoke it ==="
run "$DRY" aws iam put-role-policy --role-name "$ROLE" --policy-name invoke-video-text-chunk --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": \"lambda:InvokeFunction\",
    \"Resource\": \"arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}\"
  }]
}"
fi

echo "=== 4. 30-day lifecycle rules on s3://${BUCKET}/${RULE_PREFIX} (merge, not replace; remove mode: ${REMOVE}) ==="
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# NoSuchLifecycleConfiguration = no rules yet. Any other failure stops the script.
if aws --region "$BUCKET_REGION" s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" >"$TMP/current.json" 2>"$TMP/err.txt"; then
  :
elif grep -q NoSuchLifecycleConfiguration "$TMP/err.txt"; then
  echo '{"Rules":[]}' >"$TMP/current.json"
else
  cat "$TMP/err.txt" >&2; echo "  could not read the current lifecycle configuration — stopping"; exit 1
fi

RULE_A="{\"ID\":\"${RULE_ID}\",\"Filter\":{\"Prefix\":\"${RULE_PREFIX}\"},\"Status\":\"Enabled\",\"Expiration\":{\"Days\":30},\"NoncurrentVersionExpiration\":{\"NoncurrentDays\":1},\"AbortIncompleteMultipartUpload\":{\"DaysAfterInitiation\":1}}"
RULE_B="{\"ID\":\"${MARKER_ID}\",\"Filter\":{\"Prefix\":\"${RULE_PREFIX}\"},\"Status\":\"Enabled\",\"Expiration\":{\"ExpiredObjectDeleteMarker\":true}}"
if [ "$REMOVE" = 1 ]; then OURS="[]"; else OURS="[$RULE_A,$RULE_B]"; fi
# Drop BOTH of our IDs from the current set, then append ours (none when removing).
if command -v jq >/dev/null 2>&1; then
  jq --argjson ours "$OURS" '{Rules: (((.Rules // []) | map(select(.ID != "'"$RULE_ID"'" and .ID != "'"$MARKER_ID"'"))) + $ours)}' "$TMP/current.json" >"$TMP/merged.json"
  ids() { jq -r '.Rules[].ID // "(no id)"' "$1"; }
else
  python3 - "$TMP/current.json" "$TMP/merged.json" "$RULE_ID" "$MARKER_ID" "$OURS" <<'PY'
import json, sys
cur, out, a, b, ours = sys.argv[1:6]
rules = [r for r in (json.load(open(cur)).get("Rules") or []) if r.get("ID") not in (a, b)]
rules += json.loads(ours)
json.dump({"Rules": rules}, open(out, "w"), indent=2)
PY
  ids() { python3 -c 'import json,sys; print("\n".join(r.get("ID","(no id)") for r in json.load(open(sys.argv[1]))["Rules"]))' "$1"; }
fi
ids "$TMP/current.json" | sort >"$TMP/ids.before"; ids "$TMP/merged.json" | sort >"$TMP/ids.after"
echo "  rules before ($(grep -c . "$TMP/ids.before" || true)): $(paste -sd, "$TMP/ids.before" | sed 's/,/, /g')"
echo "  rules after  ($(grep -c . "$TMP/ids.after" || true)): $(paste -sd, "$TMP/ids.after" | sed 's/,/, /g')"
# Guard: every existing ID other than our two must survive; ours must be present (apply) or gone (remove).
grep -vxF -e "$RULE_ID" -e "$MARKER_ID" "$TMP/ids.before" >"$TMP/ids.others" || true
if [ -s "$TMP/ids.others" ] && [ -n "$(grep -vxFf "$TMP/ids.after" "$TMP/ids.others" || true)" ]; then
  echo "  merged rule set would lose another rule — refusing to put"; exit 1
fi
OURS_AFTER=$(grep -cxF -e "$RULE_ID" -e "$MARKER_ID" "$TMP/ids.after" || true)
if { [ "$REMOVE" = 1 ] && [ "$OURS_AFTER" != 0 ]; } || { [ "$REMOVE" = 0 ] && [ "$OURS_AFTER" != 2 ]; }; then
  echo "  our rules are not as expected in the merged set — refusing to put"; exit 1
fi
echo "  merged configuration:"; sed 's/^/    /' "$TMP/merged.json"
if [ ! -s "$TMP/ids.after" ]; then
  run "$DRY" aws --region "$BUCKET_REGION" s3api delete-bucket-lifecycle --bucket "$BUCKET"
else
  run "$DRY" aws --region "$BUCKET_REGION" s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration "file://$TMP/merged.json"
fi

echo "done — IAM changes can take a minute to apply; wait before the first Video Text render."
