# IAM Least-Privilege Drafts — account 975050319109

Derived 2026-06-25 from (a) each user's **actual** service usage (`get-service-last-accessed-details`), (b) existing inline policies, and (c) the app's real AWS SDK imports (`@aws-sdk/client-{dynamodb,s3,lambda,amplify}` — **no** Bedrock/SES/SSM/Secrets). Goal: remove `AdministratorAccess` from app users so the `youtube.force-ssl` token's blast radius shrinks.

**REVIEW, then apply. Nothing here has been applied.** Test from a non-admin session before deleting the old keys.

---

## 1. `poo-vaasam` — strip admin, replace with runtime-only (SAFE)
Evidence: near-idle (last real use April 2026); the live app runs as `poo-vaasam-app-user`; app surface = DynamoDB `TamilWebContent` + S3 `tamil-web-media`. The April bedrock/ec2/iam hits were ad-hoc admin use, not runtime. This policy is **strictly tighter** than its current inline (drops table/bucket *provisioning*) and covers **both** table regions so nothing breaks.

**New inline policy `poo-vaasam-runtime`:**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DataPlaneDynamoDB",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem","dynamodb:BatchGetItem","dynamodb:Query","dynamodb:Scan",
                 "dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:BatchWriteItem",
                 "dynamodb:ConditionCheckItem","dynamodb:DescribeTable"],
      "Resource": [
        "arn:aws:dynamodb:ca-central-1:975050319109:table/TamilWebContent",
        "arn:aws:dynamodb:ca-central-1:975050319109:table/TamilWebContent/index/*",
        "arn:aws:dynamodb:us-east-1:975050319109:table/TamilWebContent",
        "arn:aws:dynamodb:us-east-1:975050319109:table/TamilWebContent/index/*"
      ]
    },
    {
      "Sid": "MediaBucketObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject",
                 "s3:ListMultipartUploadParts","s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::tamil-web-media/*"
    },
    {
      "Sid": "MediaBucketList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket","s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::tamil-web-media"
    }
  ]
}
```

**Apply (after review):**
```bash
U=poo-vaasam
# 1) add the scoped policy
aws iam put-user-policy --user-name $U --policy-name poo-vaasam-runtime \
  --policy-document file://poo-vaasam-runtime.json
# 2) detach the over-broad managed policies
aws iam detach-user-policy --user-name $U --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
aws iam detach-user-policy --user-name $U --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
aws iam detach-user-policy --user-name $U --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
# 3) remove the now-superseded inline policies
aws iam delete-user-policy --user-name $U --policy-name dynomo-db-policy
aws iam delete-user-policy --user-name $U --policy-name s3-bucket-policy
# 4) AFTER verifying the app still works, rotate the access key:
#    aws iam create-access-key --user-name $U   (update consumers, then)
#    aws iam delete-access-key --user-name $U --access-key-id <OLD>
```

---

## 2. `poo-vaasam-app-user` — optional tightening (LOW risk)
Already no admin. Only over-broad part: managed `AmazonDynamoDBFullAccess` + `AmazonS3FullAccess`. Replace with the **same scoped `poo-vaasam-runtime` policy above**, and keep its two good inline policies (`amplify-start-release-deploy`, `invoke-compose-worker`). Then it can only touch its table, bucket, the one Amplify app's jobs, and the one Lambda.
```bash
U=poo-vaasam-app-user
aws iam put-user-policy --user-name $U --policy-name poo-vaasam-runtime --policy-document file://poo-vaasam-runtime.json
aws iam detach-user-policy --user-name $U --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
aws iam detach-user-policy --user-name $U --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
```
*(Once both users carry the same scope, consider consolidating to one app user.)*

---

## 3. `mobily-web` — DO NOT auto-scope (this is your active admin identity)
Usage evidence: actively used across **20+ services** (amplify, athena, backup, cloudfront, cloudtrail, cognito, dynamodb, ec2, glue, guardduty, iam, ce/budgets…), with activity **today** — it's the de-facto human ops/admin identity across the whole account (Mobily, Tamilagaval, SimPlatform…), not a single-app runtime user. Handing it a Mobily-only policy **would break ongoing ops**. Instead:
1. **Enforce MFA** on this user, and **rotate its access keys** now (admin static keys are the top target).
2. **Don't run app workloads as it.** Each app should use its own minimal user/role (as poo-vaasam-app-user does).
3. **Longer-term:** move interactive admin to **IAM Identity Center (SSO) short-lived sessions** or a dedicated `admin` role assumed with MFA; retire the long-lived admin *user* keys. This is the durable fix for "admin static keys can mint the force-ssl YouTube token."

---

## Side findings (not IAM, worth noting)
- **Duplicate table:** `TamilWebContent` exists in **both ca-central-1 (live) and us-east-1 (legacy?)**. Confirm which is authoritative; the us-east-1 copy may be stale/abandoned (drift + cost risk). The old inline policy pointed only at us-east-1 — a latent mismatch.
- After re-scoping, re-run `get-service-last-accessed-details` in ~1 week to confirm no denied calls crept up.
