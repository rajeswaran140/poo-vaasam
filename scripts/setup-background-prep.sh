#!/usr/bin/env bash
#
# ONE-TIME SETUP for joining several background clips (2026-11-07).
#
# A render over 10-20 clips cannot encode them itself: one 15 s Grok clip costs
# 34-73 s to encode to the frame on 2 cores, twenty is past the master-worker's
# 900 s. Each clip is instead prepared by its own invocation of
# `tamilagaval-background-prep` — the SAME bundle as the master-worker (its
# handler branches on `prepareBackground`), its own function so its ten at a
# time do not compete with the master-worker's reserved 3.
#
# What this does, in order:
#   1. creates tamilagaval-background-prep from master-worker.zip (build it
#      first: npm run build:master-worker && zip), same role and ffmpeg layer,
#      3008 MB / 300 s / 2 GB scratch (one clip at a time);
#   2. reserves 10 concurrent executions for it;
#   3. lets the shared worker role invoke it (inline policy
#      invoke-background-prep) — the master-worker calls it synchronously.
#
# After this, `npm run deploy:master-worker` updates both functions' code.
#
# USAGE:  ./scripts/setup-background-prep.sh          # apply
#         ./scripts/setup-background-prep.sh --dry    # print the commands only
set -euo pipefail

REGION="${AWS_REGION:-ca-central-1}"
ACCOUNT="975050319109"
FN="tamilagaval-background-prep"
ROLE="tamilagaval-compose-worker-role"
LAYER="arn:aws:lambda:${REGION}:${ACCOUNT}:layer:tamilagaval-ffmpeg:1"
ZIP="master-worker.zip"
run() { if [ "${1:-}" = "--dry" ]; then shift; echo "+ $*"; else shift; "$@"; fi; }
DRY="${1:-}"

[ -f "$ZIP" ] || { echo "Build $ZIP first: npm run build:master-worker && (cd master-worker-dist && zip -q -r ../$ZIP index.js)"; exit 1; }

echo "=== 1. create $FN ==="
if aws --region "$REGION" lambda get-function --function-name "$FN" >/dev/null 2>&1; then
  echo "  exists — updating its code only"
  run "$DRY" aws --region "$REGION" lambda update-function-code --function-name "$FN" --zip-file "fileb://$ZIP" --query LastModified --output text
else
  run "$DRY" aws --region "$REGION" lambda create-function \
    --function-name "$FN" \
    --runtime nodejs20.x --handler index.handler --architectures x86_64 \
    --role "arn:aws:iam::${ACCOUNT}:role/${ROLE}" \
    --layers "$LAYER" \
    --memory-size 3008 --timeout 300 --ephemeral-storage Size=2048 \
    --environment 'Variables={TAKES_BUCKET=tamil-web-media,TAKES_BUCKET_REGION=us-east-1}' \
    --zip-file "fileb://$ZIP" \
    --query FunctionArn --output text
fi

echo "=== 2. reserve 10 concurrent ==="
run "$DRY" aws --region "$REGION" lambda put-function-concurrency --function-name "$FN" \
  --reserved-concurrent-executions 10 --query ReservedConcurrentExecutions --output text

echo "=== 3. allow the worker role to invoke it ==="
run "$DRY" aws iam put-role-policy --role-name "$ROLE" --policy-name invoke-background-prep --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Effect\": \"Allow\",
    \"Action\": \"lambda:InvokeFunction\",
    \"Resource\": \"arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FN}\"
  }]
}"
echo "done"
