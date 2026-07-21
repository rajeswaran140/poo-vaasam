# PIPEDA Data-Subject Runbook — Performer accounts (blocker 3b)

Handles a performer's **right of access** and **right of erasure** under PIPEDA.
Low-volume, manual, and deliberately so — this is the documented process, not
automation. Every fulfilment is logged (see "Log" below).

## Where a performer's personal data lives

| Store | Record | Personal data |
|---|---|---|
| **Cognito** pool `ca-central-1_JPXdswqHE` | the user (username = email) | email, sub (id), verification status, timestamps |
| **DynamoDB** `TamilWebContent` (ca-central-1) | `PK=SUBSCRIBER#<email>`, `SK=METADATA` | email, optional name, source, status |
| **DynamoDB** `TamilWebContent` | `PK=CONSENT#<sub>`, `SK=TERMS#<version>` (one per accepted version) | consent audit: userId, email?, termsVersion, acceptedAt |

**Not personal data (do NOT delete):** karaoke instrumentals in
`tamil-web-media-gated` and song content — creative assets, not the subject's data.

**Also sweep if present** (same email/sub): `CONTACT#<…>` (contact form) and any
story submissions — out of scope for the performer tier but check, since a person
may appear in more than one surface.

All commands use `--region ca-central-1`.

## Step 0 — Identify the subject

A request usually arrives by email. Resolve email → Cognito `sub` (needed for the
`CONSENT#` key):

```bash
EMAIL="<subject-email>"
aws cognito-idp admin-get-user --user-pool-id ca-central-1_JPXdswqHE \
  --username "$EMAIL" --region ca-central-1
# note the `sub` from UserAttributes:
SUB=$(aws cognito-idp admin-get-user --user-pool-id ca-central-1_JPXdswqHE \
  --username "$EMAIL" --region ca-central-1 \
  --query "UserAttributes[?Name=='sub'].Value | [0]" --output text)
echo "sub=$SUB"
```

## Right of ACCESS — compile everything held

Gather (read-only) and return a plain report to the subject:

```bash
# 1) Cognito identity + attributes (above: admin-get-user)
# 2) Subscriber record
aws dynamodb get-item --table-name TamilWebContent --region ca-central-1 \
  --key "{\"PK\":{\"S\":\"SUBSCRIBER#$EMAIL\"},\"SK\":{\"S\":\"METADATA\"}}"
# 3) Consent audit trail (all accepted terms versions)
aws dynamodb query --table-name TamilWebContent --region ca-central-1 \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values "{\":pk\":{\"S\":\"CONSENT#$SUB\"}}"
```

Summarise the three outputs into the access response. Respond within the statutory
window (PIPEDA: generally 30 days).

## Right of ERASURE — delete everything held

Order: DynamoDB records first, Cognito user last (so the `sub` is still resolvable
while deleting `CONSENT#<sub>`).

```bash
# 1) Delete every consent record (one per terms version)
for SK in $(aws dynamodb query --table-name TamilWebContent --region ca-central-1 \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values "{\":pk\":{\"S\":\"CONSENT#$SUB\"}}" \
  --query "Items[].SK.S" --output text); do
  aws dynamodb delete-item --table-name TamilWebContent --region ca-central-1 \
    --key "{\"PK\":{\"S\":\"CONSENT#$SUB\"},\"SK\":{\"S\":\"$SK\"}}"
done

# 2) Delete the subscriber lead record
aws dynamodb delete-item --table-name TamilWebContent --region ca-central-1 \
  --key "{\"PK\":{\"S\":\"SUBSCRIBER#$EMAIL\"},\"SK\":{\"S\":\"METADATA\"}}"

# 3) Delete the Cognito account (pool deletion-protection is per-pool, not
#    per-user — admin-delete-user is unaffected)
aws cognito-idp admin-delete-user --user-pool-id ca-central-1_JPXdswqHE \
  --username "$EMAIL" --region ca-central-1
```

### Verify (all must come back empty / not-found)

```bash
aws dynamodb get-item --table-name TamilWebContent --region ca-central-1 \
  --key "{\"PK\":{\"S\":\"SUBSCRIBER#$EMAIL\"},\"SK\":{\"S\":\"METADATA\"}}"   # → {} (no Item)
aws dynamodb query --table-name TamilWebContent --region ca-central-1 \
  --key-condition-expression "PK = :pk" \
  --expression-attribute-values "{\":pk\":{\"S\":\"CONSENT#$SUB\"}}"           # → Count 0
aws cognito-idp admin-get-user --user-pool-id ca-central-1_JPXdswqHE \
  --username "$EMAIL" --region ca-central-1                                    # → UserNotFoundException
```

## Log

Keep a minimal fulfilment log (append-only, access-controlled) — this is itself a
lawful record of the request, not a breach of the erasure:

```
<date> | <request type: access|erasure> | <subject email, hashed or masked> | actions taken | operator
```

## Notes

- **Scope creep check:** if the subject also used the public contact form or story
  features, delete those records too (search `CONTACT#`, story items by email).
- **Backups:** the daily AWS→Azure backup (see the tamilagaval-backups memory)
  retains copies; note in the log that backups age out per their retention and are
  not individually scrubbed — state this in the erasure response if asked.
- This runbook clears **crux #3b**; combined with 3a (consent persistence, already
  landed) it clears crux #3 in `docs/PERFORMERS_MASTER_REVIEW.md`.
