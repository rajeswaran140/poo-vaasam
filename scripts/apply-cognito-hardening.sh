#!/usr/bin/env bash
#
# Codifies the production Cognito user-pool hardening applied on 2026-08-20.
# Idempotent — safe to re-run. Prints before/after state so drift is visible.
#
# WHAT THIS DOES:
#   1. Disables Cognito self-signup on the production pool (AllowAdminCreateUserOnly=true).
#      → Random internet visitors can no longer create Cognito accounts. Existing
#        users unaffected. Any new admin must be admin-created.
#   2. Enables TOTP MFA as OPTIONAL.
#      → Users CAN enroll a TOTP authenticator (Google Authenticator, Authy, etc.);
#        MFA is not yet REQUIRED (that step is intentionally manual — see below).
#
# WHY NOT `MfaConfiguration=ON` HERE:
#   Flipping the pool to `ON` before the sole admin has enrolled a TOTP device
#   would lock them out at next login (Cognito requires enrollment mid-flow, and
#   any client that doesn't render the enrollment challenge just fails). Enrol
#   first → then flip to ON manually (see final section).
#
# PREREQUISITES:
#   - awscli v2 configured with credentials that have cognito-idp:DescribeUserPool
#     + UpdateUserPool + SetUserPoolMfaConfig on the target pool.
#   - jq (for readable output)
#
# USAGE:
#   ./scripts/apply-cognito-hardening.sh
#
set -euo pipefail

POOL_ID="${TAMILAGAVAL_COGNITO_POOL_ID:-ca-central-1_JPXdswqHE}"
REGION="${AWS_REGION:-ca-central-1}"

echo "=== production Cognito pool hardening — pool: $POOL_ID (region $REGION) ==="

echo
echo '=== [1/4] pre-state ==='
aws --region "$REGION" cognito-idp describe-user-pool --user-pool-id "$POOL_ID" \
  --query 'UserPool.[AdminCreateUserConfig.AllowAdminCreateUserOnly, MfaConfiguration, LastModifiedDate]' \
  --output text | awk 'BEGIN{OFS="\n"} {print "  AllowAdminCreateUserOnly: "$1, "  MfaConfiguration:         "$2, "  LastModifiedDate:         "$3}'

echo
echo '=== [2/4] disable self-signup (AllowAdminCreateUserOnly=true) ==='
aws --region "$REGION" cognito-idp update-user-pool --user-pool-id "$POOL_ID" \
  --admin-create-user-config AllowAdminCreateUserOnly=true
echo '  applied.'

echo
echo '=== [3/4] enable TOTP MFA as OPTIONAL ==='
aws --region "$REGION" cognito-idp set-user-pool-mfa-config \
  --user-pool-id "$POOL_ID" \
  --mfa-configuration OPTIONAL \
  --software-token-mfa-configuration Enabled=true \
  --query '[MfaConfiguration, SoftwareTokenMfaConfiguration.Enabled]' --output text \
  | awk '{print "  MfaConfiguration: "$1"  SoftwareTokenMfaEnabled: "$2}'

echo
echo '=== [4/4] post-state ==='
aws --region "$REGION" cognito-idp describe-user-pool --user-pool-id "$POOL_ID" \
  --query 'UserPool.[AdminCreateUserConfig.AllowAdminCreateUserOnly, MfaConfiguration, LastModifiedDate]' \
  --output text | awk 'BEGIN{OFS="\n"} {print "  AllowAdminCreateUserOnly: "$1, "  MfaConfiguration:         "$2, "  LastModifiedDate:         "$3}'

cat <<'FOLLOWUP'

=== NEXT STEP — you (manually), then rerun the ON flip ===
1. Log in to https://tamilagaval.com/login as the admin user.
2. Enrol a TOTP authenticator (Google Authenticator, Authy, 1Password, Bitwarden).
   Amplify UI Authenticator supports the enrolment flow out of the box.
   Alternative: Cognito Hosted UI at
   https://ca-central-1jpxdswqhe.auth.ca-central-1.amazoncognito.com/mfa
3. Once enrolled + a login has confirmed with the second factor, flip MFA to REQUIRED:

     aws cognito-idp set-user-pool-mfa-config \
       --region ca-central-1 \
       --user-pool-id ca-central-1_JPXdswqHE \
       --mfa-configuration ON \
       --software-token-mfa-configuration Enabled=true

4. To verify enrolment state before flipping:

     aws cognito-idp admin-get-user \
       --region ca-central-1 \
       --user-pool-id ca-central-1_JPXdswqHE \
       --username 3ccd3518-d0d1-709b-c087-1258567396dd \
       --query 'UserMFASettingList'

   → expect ["SOFTWARE_TOKEN_MFA"] (not null / [])
FOLLOWUP
