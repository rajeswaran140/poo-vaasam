#!/usr/bin/env bash
#
# Build + push + update the tamilagaval-matchering-worker container Lambda.
#
# For subsequent updates only. The FIRST deploy (which created the ECR repo,
# IAM role, and Lambda function) was performed as a one-time bootstrap on
# 2026-08-26 — see worker/matchering_worker/README.md for the bootstrap steps.
#
# Usage: bash scripts/deploy-matchering-worker.sh
#   or:  npm run deploy:matchering-worker
#
# Requires: docker daemon running, aws CLI configured for account 975050319109.

set -euo pipefail

AWS_ACCOUNT=975050319109
REGION=ca-central-1
ECR_REPO=tamilagaval-matchering-worker
IMG_URI="${AWS_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}:v1"
FN=tamilagaval-matchering-worker

echo "== 1. build image =="
sudo docker build -t "${ECR_REPO}:local" worker/matchering_worker

echo "== 2. login to ECR + push =="
aws ecr get-login-password --region "$REGION" | sudo docker login --username AWS --password-stdin "${AWS_ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
sudo docker tag "${ECR_REPO}:local" "$IMG_URI"
sudo docker push "$IMG_URI"

echo "== 3. update Lambda function code =="
aws lambda update-function-code \
  --function-name "$FN" \
  --image-uri "$IMG_URI" \
  --region "$REGION" \
  --query 'LastUpdateStatus' --output text

echo "== 4. wait for update to complete =="
aws lambda wait function-updated --function-name "$FN" --region "$REGION"

echo "== done. Function: $FN. Image: $IMG_URI =="
