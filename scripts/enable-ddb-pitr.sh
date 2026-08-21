#!/usr/bin/env bash
#
# Enables DynamoDB Point-in-Time Recovery (PITR) on the TamilWebContent table
# in the production region (ca-central-1).
#
# PITR gives a rolling 35-day recovery window. Any point can be restored to a
# NEW table (never in-place), so this is the anti-oops backstop against:
#   - accidental delete-item / update-item (missed key, wrong condition)
#   - a bug in code that overwrites the wrong record shape
#   - an admin action that isn't recoverable from the app
#
# Cost: ~$0.20 per GB-month on the table's size (currently ~1.5 MB in prod →
# effectively free). No throughput cost.
#
# The us-east-1 copy of TamilWebContent (8 items, dev leftover) is left alone —
# it's not the production data and PITR would just be spend on empty rows.
#
# PREREQUISITES:
#   awscli v2 with dynamodb:UpdateContinuousBackups + DescribeContinuousBackups.
#
# USAGE:
#   ./scripts/enable-ddb-pitr.sh          # apply
#   ./scripts/enable-ddb-pitr.sh --dry    # report only
#
set -euo pipefail

REGION="${AWS_REGION:-ca-central-1}"
TABLE="${TAMILAGAVAL_DDB_TABLE:-TamilWebContent}"
DRY="${1:-}"

echo "=== DynamoDB PITR — table $TABLE (region $REGION) ==="

status=$(aws --region "$REGION" dynamodb describe-continuous-backups \
  --table-name "$TABLE" \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus' \
  --output text)
echo "  current PITR status: $status"

if [ "$status" = "ENABLED" ]; then
  echo '  already enabled — nothing to do'
  exit 0
fi

if [ "$DRY" = "--dry" ]; then
  echo '  (dry-run — would enable)'
  exit 0
fi

aws --region "$REGION" dynamodb update-continuous-backups \
  --table-name "$TABLE" \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true \
  --query 'ContinuousBackupsDescription.PointInTimeRecoveryDescription.[PointInTimeRecoveryStatus, EarliestRestorableDateTime, LatestRestorableDateTime]' \
  --output text | awk 'BEGIN{OFS="\n"} {print "  PITR status:            "$1, "  Earliest restorable:    "$2, "  Latest restorable:      "$3}'

cat <<'RECOVERY'

=== recovery cheat-sheet (keep this handy) ===
To restore to a point in time (creates a NEW table; original is untouched):

  aws dynamodb restore-table-to-point-in-time \
    --region ca-central-1 \
    --source-table-name TamilWebContent \
    --target-table-name TamilWebContent-restore-$(date -u +%Y%m%d-%H%M%S) \
    --restore-date-time 2026-08-20T14:00:00Z

Then read from / re-populate from the restored table. PITR CANNOT restore into
the original table name — swapping is a manual operation the app must handle.
RECOVERY
