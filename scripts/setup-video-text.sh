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
# USAGE:  ./scripts/setup-video-text.sh          # apply
#         ./scripts/setup-video-text.sh --dry    # print the write commands only
#                                                # (read-only AWS calls still run)
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
RULE_PREFIX="audio/mastering/video-text/"
run() { if [ "${1:-}" = "--dry" ]; then shift; echo "+ $*"; else shift; "$@"; fi; }
DRY="${1:-}"

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
# AWS refuses a reservation that leaves the account under 100 unreserved.
UNRESERVED=$(aws --region "$REGION" lambda get-account-settings --query AccountLimit.UnreservedConcurrentExecutions --output text)
echo "  unreserved now: $UNRESERVED"
if [ "$UNRESERVED" -lt 120 ]; then echo "  too few unreserved executions to reserve 20 — stopping"; exit 1; fi
run "$DRY" aws --region "$REGION" lambda put-function-concurrency --function-name "$FN" \
  --reserved-concurrent-executions 20 --query ReservedConcurrentExecutions --output text

echo "=== 3. allow the worker role to invoke it ==="
run "$DRY" aws iam put-role-policy --role-name "$ROLE" --policy-name invoke-video-text-chunk --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": \"lambda:InvokeFunction\",
    \"Resource\": \"arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}\"
  }]
}"

echo "=== 4. 30-day lifecycle rule on s3://${BUCKET}/${RULE_PREFIX} (merge, not replace) ==="
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# NoSuchLifecycleConfiguration = no rules yet. Any other failure stops the script.
if aws --region "$BUCKET_REGION" s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" >"$TMP/current.json" 2>"$TMP/err.txt"; then
  :
elif grep -q NoSuchLifecycleConfiguration "$TMP/err.txt"; then
  echo '{"Rules":[]}' >"$TMP/current.json"
else
  cat "$TMP/err.txt" >&2; echo "  could not read the current lifecycle configuration — stopping"; exit 1
fi

NEW_RULE="{\"ID\":\"${RULE_ID}\",\"Filter\":{\"Prefix\":\"${RULE_PREFIX}\"},\"Status\":\"Enabled\",\"Expiration\":{\"Days\":30},\"AbortIncompleteMultipartUpload\":{\"DaysAfterInitiation\":1}}"
if command -v jq >/dev/null 2>&1; then
  jq --argjson r "$NEW_RULE" '{Rules: (((.Rules // []) | map(select(.ID != "'"$RULE_ID"'"))) + [$r])}' "$TMP/current.json" >"$TMP/merged.json"
  ids() { jq -r '[.Rules[].ID // "(no id)"] | join(", ")' "$1"; }
  count() { jq '.Rules | length' "$1"; }
  has_rule() { jq '[.Rules[] | select(.ID == "'"$RULE_ID"'")] | length' "$1"; }
else
  python3 - "$TMP/current.json" "$TMP/merged.json" "$RULE_ID" "$NEW_RULE" <<'PY'
import json, sys
cur, out, rid, rule = sys.argv[1:5]
rules = [r for r in (json.load(open(cur)).get("Rules") or []) if r.get("ID") != rid]
rules.append(json.loads(rule))
json.dump({"Rules": rules}, open(out, "w"), indent=2)
PY
  ids() { python3 -c 'import json,sys; print(", ".join(r.get("ID","(no id)") for r in json.load(open(sys.argv[1]))["Rules"]))' "$1"; }
  count() { python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["Rules"]))' "$1"; }
  has_rule() { python3 -c 'import json,sys; print(sum(1 for r in json.load(open(sys.argv[1]))["Rules"] if r.get("ID")==sys.argv[2]))' "$1" "$RULE_ID"; }
fi

BEFORE=$(count "$TMP/current.json"); AFTER=$(count "$TMP/merged.json")
echo "  rules before ($BEFORE): $(ids "$TMP/current.json")"
echo "  rules after  ($AFTER): $(ids "$TMP/merged.json")"
# The merge drops at most the one old copy of our own rule; anything lower means other rules would be wiped.
if [ "$AFTER" -lt $((BEFORE - 1)) ] || [ "$(has_rule "$TMP/merged.json")" != "1" ]; then
  echo "  merged rule set looks wrong (would wipe other rules) — refusing to put"; exit 1
fi
echo "  merged configuration:"; sed 's/^/    /' "$TMP/merged.json"
run "$DRY" aws --region "$BUCKET_REGION" s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration "file://$TMP/merged.json"

echo "done — IAM changes can take a minute to apply; wait before the first Video Text render."
