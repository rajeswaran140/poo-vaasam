#!/usr/bin/env bash
#
# Sets reserved concurrency on the Tamilagaval worker Lambdas.
#
# WHY: `/api/admin/mastering/analyse` and `/api/admin/music-lab/master` invoke
# `tamilagaval-master-worker` asynchronously (`InvocationType: Event`). A
# compromised admin session — or a bug in a client that fires the trigger in a
# loop — can rapidly queue many concurrent executions of a 3008-MB / 900-s Lambda,
# which is (a) expensive and (b) starves other functions of account concurrency
# (default 1000 in a fresh account, but shared across every Lambda in the region).
#
# Reserved concurrency puts a hard ceiling on how many copies of the function can
# run at once. Above the ceiling, invocations queue (async) or 429 (sync). It ALSO
# guarantees the function has that much capacity available even under noisy-neighbour
# load from other functions — belt-and-suspenders.
#
# CHOSEN LIMITS (rationale in each `case` branch below):
#   tamilagaval-master-worker     3   (historical: 8 invocations/day; 3 covers realistic bursts)
#   tamilagaval-compose-worker    3   (historical: near-zero; 3 is comfortable)
#   tamilagaval-measure-fn        3   (fast — 60 s max — 3 is plenty)
#   tamilagaval-yt-snapshot       2   (5-min cron = 1 concurrent expected; +1 for manual)
#
# PREREQUISITES:
#   awscli v2 with lambda:PutFunctionConcurrency + GetFunctionConcurrency.
#
# USAGE:
#   ./scripts/apply-lambda-concurrency-limits.sh          # apply
#   ./scripts/apply-lambda-concurrency-limits.sh --dry    # show only, do not apply
#
set -euo pipefail

REGION="${AWS_REGION:-ca-central-1}"
DRY="${1:-}"

apply() {
  local fn="$1" limit="$2" why="$3"
  echo "--- $fn  (limit=$limit)  — $why"

  current=$(aws --region "$REGION" lambda get-function-concurrency \
    --function-name "$fn" \
    --query 'ReservedConcurrentExecutions' --output text 2>/dev/null || echo 'None')
  echo "  current reserved concurrency: $current"

  if [ "$DRY" = "--dry" ]; then
    echo '  (dry-run — no change)'
    return
  fi

  if [ "$current" = "$limit" ]; then
    echo '  already at target — skipping'
    return
  fi

  aws --region "$REGION" lambda put-function-concurrency \
    --function-name "$fn" \
    --reserved-concurrent-executions "$limit" \
    --query 'ReservedConcurrentExecutions' --output text \
    | awk '{print "  new reserved concurrency: "$1}'
}

echo "=== Tamilagaval Lambda concurrency limits (region $REGION) ==="
[ "$DRY" = "--dry" ] && echo '  DRY-RUN mode — reporting only'

apply tamilagaval-master-worker  3 "3008 MB / 900 s; historical 8 invs/day"
apply tamilagaval-compose-worker 3 "512 MB / 180 s; near-zero baseline"
apply tamilagaval-measure-fn     3 "1024 MB / 60 s; fast, low volume"
apply tamilagaval-yt-snapshot    2 "128 MB / 30 s; 5-min cron = 1 concurrent expected"

echo
echo '=== to unlimit a function later (removes the cap): ==='
echo '  aws --region '"$REGION"' lambda delete-function-concurrency --function-name <name>'
