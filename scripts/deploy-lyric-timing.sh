#!/usr/bin/env bash
#
# Build + deploy the tamilagaval-lyric-timing container Lambda.
#
# The image (torch + demucs + faster-whisper + both models, ~3.5 GB) is built
# by CodeBuild, not here: the shared dev box has too little disk. This script
# uploads the worker folder, runs the build, and points the Lambda at the new
# image. One-time setup is in worker/lyric_timing_worker/README.md.
#
# Usage: bash scripts/deploy-lyric-timing.sh
set -euo pipefail
AWS_ACCOUNT=975050319109
REGION=ca-central-1
PROJECT=tamilagaval-lyric-timing-build
BUCKET=tamilagaval-lyric-timing-build-${AWS_ACCOUNT}
FN=tamilagaval-lyric-timing
IMG_URI="${AWS_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/tamilagaval-lyric-timing:v1"
ZIP="$(mktemp -d)/lt-src.zip"

echo "== 1. upload the worker source =="
(cd worker/lyric_timing_worker && zip -q "$ZIP" Dockerfile requirements.txt handler.py buildspec.yml)
aws s3 cp --quiet "$ZIP" "s3://${BUCKET}/source/lt-src.zip"

echo "== 2. build the image in CodeBuild (10-15 min) =="
BUILD=$(aws codebuild start-build --project-name "$PROJECT" --region "$REGION" --query build.id --output text)
echo "   $BUILD"
while :; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD" --region "$REGION" --query 'builds[0].buildStatus' --output text)
  [ "$STATUS" != "IN_PROGRESS" ] && break
  sleep 20
done
if [ "$STATUS" != "SUCCEEDED" ]; then
  echo "BUILD $STATUS — see: aws logs tail /aws/codebuild/${PROJECT} --region ${REGION} --since 1h" >&2
  exit 1
fi

echo "== 3. point the Lambda at the new image =="
aws lambda update-function-code --function-name "$FN" --image-uri "$IMG_URI" --region "$REGION" --query LastUpdateStatus --output text
aws lambda wait function-updated-v2 --function-name "$FN" --region "$REGION"
echo "== done. Function: $FN. Image: $IMG_URI =="
