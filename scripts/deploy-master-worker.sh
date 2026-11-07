#!/usr/bin/env bash
#
# Builds master-worker.zip and updates the code of every function that runs
# that bundle: tamilagaval-master-worker, and — when they exist —
# tamilagaval-background-prep and tamilagaval-video-text-chunk (they must run
# the same bundle as the master-worker).
#
# A function that does not exist yet (ResourceNotFoundException) is skipped
# with a message. Any OTHER failure (a failed update, a failed build, a
# get-function that fails for another reason) fails the script: it is never
# swallowed into "skipped".
#
# USAGE:  npm run deploy:master-worker   (or ./scripts/deploy-master-worker.sh)
set -euo pipefail

REGION="ca-central-1"
ZIP="master-worker.zip"

cd "$(dirname "$0")/.."
npm run build:master-worker
(cd master-worker-dist && zip -q -r "../$ZIP" index.js)

aws lambda update-function-code --function-name tamilagaval-master-worker \
  --zip-file "fileb://$ZIP" --region "$REGION"

update_if_set_up() {
  local fn="$1" setup="$2" err
  if err=$(aws lambda get-function --function-name "$fn" --region "$REGION" 2>&1 >/dev/null); then
    aws lambda update-function-code --function-name "$fn" --zip-file "fileb://$ZIP" --region "$REGION"
  elif grep -q ResourceNotFoundException <<<"$err"; then
    echo "$fn not set up yet ($setup) - skipped"
  else
    # Credentials, network, permissions: not "not set up". Stop.
    echo "$err" >&2
    echo "could not check $fn - stopping" >&2
    exit 1
  fi
}

update_if_set_up tamilagaval-background-prep scripts/setup-background-prep.sh
update_if_set_up tamilagaval-video-text-chunk scripts/setup-video-text.sh
