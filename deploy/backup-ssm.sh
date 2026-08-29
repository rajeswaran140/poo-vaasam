#!/usr/bin/env bash
#
# Dump every SSM SecureString parameter Tamilagaval depends on to a single
# AES-256-encrypted JSON file. Losing SSM (region loss, account compromise,
# accidental deletion) without a copy means:
#   - Anthropic / Gemini / OpenAI keys → re-issue from each vendor
#   - VAPID / cron / lyrics-gate secrets → regenerate + redeploy
#   - YouTube OAuth refresh tokens → full re-consent flow, browser-interactive,
#     ~30 min per token, and it happens in the middle of an emergency
# So this exists.
#
# Scope: the two prefixes that this project reads from —
#   /amplify/d3rkmepk4popv0/master/*   (Amplify runtime secrets)
#   /tamilagaval/*                     (per-env secrets outside Amplify)
# Prosevox and other unrelated prefixes are deliberately excluded so a leaked
# backup here has minimum blast radius.
#
# Usage:
#   SSM_BACKUP_PASSPHRASE='...' ./deploy/backup-ssm.sh                 # default output dir
#   SSM_BACKUP_PASSPHRASE='...' ./deploy/backup-ssm.sh /path/to/out    # explicit dir
#
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
#     -in ssm-backup-<timestamp>.json.enc -out ssm-backup.json \
#     -pass env:SSM_BACKUP_PASSPHRASE
#   jq -r '.[] | "aws ssm put-parameter --overwrite --name \(.Name) --type SecureString --value \(.Value | @sh)"' ssm-backup.json
#   # Review then pipe to `bash` to restore each parameter.

set -euo pipefail

REGION=ca-central-1
OUT_DIR="${1:-/home/devuser/backups/ssm}"

if [ -z "${SSM_BACKUP_PASSPHRASE:-}" ]; then
  echo "SSM_BACKUP_PASSPHRASE not set — refusing to write plaintext or a weak backup" >&2
  echo "  set it in your shell profile (or a private file sourced on demand) and re-run" >&2
  exit 2
fi

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

TS=$(date -u +%Y%m%dT%H%M%SZ)
PLAINTEXT="${OUT_DIR}/.ssm-backup-${TS}.json"
CIPHERTEXT="${OUT_DIR}/ssm-backup-${TS}.json.enc"

# Enumerate the two Tamilagaval-relevant prefixes.
NAMES=$(mktemp)
trap 'rm -f "$NAMES" "$PLAINTEXT"' EXIT
{
  aws --region "$REGION" ssm describe-parameters \
    --parameter-filters "Key=Name,Option=BeginsWith,Values=/amplify/d3rkmepk4popv0/master/" \
    --query 'Parameters[?Type==`SecureString`].Name' --output text | tr '\t' '\n'
  aws --region "$REGION" ssm describe-parameters \
    --parameter-filters "Key=Name,Option=BeginsWith,Values=/tamilagaval/" \
    --query 'Parameters[?Type==`SecureString`].Name' --output text | tr '\t' '\n'
} | sort -u > "$NAMES"

COUNT=$(wc -l < "$NAMES")
[ "$COUNT" -gt 0 ] || { echo "no SecureString parameters found in the two prefixes"; exit 3; }
echo "==> dumping ${COUNT} SecureString parameters"

# Read in batches of 10 (get-parameters max). Output a JSON array.
{
  echo '['
  first=1
  while IFS= read -r batch; do
    [ -z "$batch" ] && continue
    aws --region "$REGION" ssm get-parameters --with-decryption --names $batch \
      --query 'Parameters[].{Name:Name,Value:Value,Type:Type,Version:Version,LastModifiedDate:LastModifiedDate}' \
      --output json | jq -c '.[]' | while read -r row; do
        if [ "$first" -eq 1 ]; then first=0; else echo ','; fi
        printf '%s' "$row"
      done
  done < <(awk 'NR%10==1{printf "\n"} {printf "%s ", $0}' "$NAMES")
  echo ''
  echo ']'
} > "$PLAINTEXT"

# Encrypt. PBKDF2 200k iterations is above openssl's default and defends
# against modern GPU brute-force at a reasonable passphrase strength.
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$PLAINTEXT" \
  -out "$CIPHERTEXT" \
  -pass env:SSM_BACKUP_PASSPHRASE

chmod 600 "$CIPHERTEXT"
SIZE=$(wc -c < "$CIPHERTEXT")
SHA=$(sha256sum "$CIPHERTEXT" | awk '{print $1}')

echo "==> wrote ${CIPHERTEXT}  (${SIZE} bytes)"
echo "    sha256: ${SHA}"
echo
echo "next: mirror ${CIPHERTEXT} off-box (e.g. another AWS region, GCS, Backblaze)"
echo "      OR run this script again with --out to a mounted external location."
