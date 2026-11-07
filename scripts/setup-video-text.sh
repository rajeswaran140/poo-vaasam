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
#   4. lets the same role list and delete under audio/mastering/video-text/
#      (inline policy video-text-s3-cleanup): after a render the worker lists
#      the render's folder and deletes its intermediates. The role otherwise
#      has only GetObject + PutObject on audio/mastering/*;
#   5. adds TWO S3 lifecycle rules on tamil-web-media for
#      audio/mastering/video-text/ (video-text-30d and video-text-markers, see
#      below). The bucket already carries other rules, so this MERGES: it reads
#      the current configuration, replaces/appends only our two IDs, keeps the
#      bucket's TransitionDefaultMinimumObjectSize, and puts the result.
#
# After this, `npm run deploy:master-worker` updates all three functions' code.
#
# The bucket is VERSIONED, so Expiration alone only adds a delete marker. The
# 30-day rule therefore also expires noncurrent versions after 1 day, and a
# second rule (video-text-markers) removes the leftover delete markers.
#
# USAGE:  ./scripts/setup-video-text.sh                       # apply
#         ./scripts/setup-video-text.sh --dry                 # print the write commands only
#                                                             # (read-only AWS calls still run)
#         ./scripts/setup-video-text.sh --remove-lifecycle    # rollback: drop only our two
#                                                             # lifecycle rules (steps 1-4 untouched)
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
BUILD_HINT="npm run build:master-worker && (cd master-worker-dist && zip -q -r ../$ZIP index.js)"
if [ ! -f "$ZIP" ]; then
  # A dry run only prints the writes, so it can go on without the zip.
  if [ -n "$DRY" ]; then echo "(dry) $ZIP is not built yet — build it before the real run: $BUILD_HINT"
  else echo "Build $ZIP first: $BUILD_HINT"; exit 1; fi
fi

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

echo "=== 4. allow the worker role to list and delete under ${RULE_PREFIX} (intermediate cleanup) ==="
run "$DRY" aws iam put-role-policy --role-name "$ROLE" --policy-name video-text-s3-cleanup --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": \"s3:ListBucket\",
    \"Resource\": \"arn:aws:s3:::${BUCKET}\",
    \"Condition\": { \"StringLike\": { \"s3:prefix\": \"${RULE_PREFIX}*\" } }
  }, {
    \"Effect\": \"Allow\",
    \"Action\": \"s3:DeleteObject\",
    \"Resource\": \"arn:aws:s3:::${BUCKET}/${RULE_PREFIX}*\"
  }]
}"
fi

echo "=== 5. 30-day lifecycle rules on s3://${BUCKET}/${RULE_PREFIX} (merge, not replace; remove mode: ${REMOVE}) ==="
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
  MIN_SIZE=$(jq -r '.TransitionDefaultMinimumObjectSize // empty' "$TMP/current.json")
else
  python3 - "$TMP/current.json" "$TMP/merged.json" "$RULE_ID" "$MARKER_ID" "$OURS" <<'PY'
import json, sys
cur, out, a, b, ours = sys.argv[1:6]
rules = [r for r in (json.load(open(cur)).get("Rules") or []) if r.get("ID") not in (a, b)]
rules += json.loads(ours)
with open(out, "w") as f:
    json.dump({"Rules": rules}, f, indent=2)
    f.write("\n")
PY
  # One line per ID and NOTHING for an empty set, so an emptied configuration
  # is seen as empty below (delete-bucket-lifecycle, not a put of zero rules).
  ids() { python3 -c 'import json,sys
for r in json.load(open(sys.argv[1]))["Rules"]: print(r.get("ID","(no id)"))' "$1"; }
  MIN_SIZE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("TransitionDefaultMinimumObjectSize") or "")' "$TMP/current.json")
fi
# The GET returns the bucket's TransitionDefaultMinimumObjectSize beside the
# rules; the PUT takes it as a separate flag, and leaving it out resets it to
# the default. Pass the current value through unchanged.
MIN_SIZE_ARGS=()
[ -n "$MIN_SIZE" ] && MIN_SIZE_ARGS=(--transition-default-minimum-object-size "$MIN_SIZE")
echo "  TransitionDefaultMinimumObjectSize: ${MIN_SIZE:-(not set)}"
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
  --lifecycle-configuration "file://$TMP/merged.json" ${MIN_SIZE_ARGS[@]+"${MIN_SIZE_ARGS[@]}"}
fi

echo "done — IAM changes can take a minute to apply; wait before the first Video Text render."
