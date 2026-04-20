# AWS IAM Inline Policies for Poo Vaasam

This document contains all the IAM policies needed for the Tamil content publishing platform.

## Overview

You'll need to create an IAM user or role with the following inline policies attached. These policies follow the **principle of least privilege** while providing all necessary permissions.

---

## 1. DynamoDB Policy

**Policy Name**: `PooVaasam-DynamoDB-Policy`

**Description**: Allows full access to the TamilWebContent DynamoDB table and its indexes.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBTableAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:PutItem",
        "dynamodb:DescribeTable",
        "dynamodb:DeleteItem",
        "dynamodb:GetItem",
        "dynamodb:Scan",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
        "dynamodb:GetRecords"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:*:table/TamilWebContent",
        "arn:aws:dynamodb:us-east-1:*:table/TamilWebContent/index/*"
      ]
    },
    {
      "Sid": "DynamoDBStreamAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:*:table/TamilWebContent/stream/*"
    },
    {
      "Sid": "DynamoDBTableCreation",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DescribeTable",
        "dynamodb:UpdateTable",
        "dynamodb:DeleteTable",
        "dynamodb:ListTables",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:UpdateTimeToLive"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:*:table/TamilWebContent"
    }
  ]
}
```

---

## 2. S3 Policy

**Policy Name**: `PooVaasam-S3-Policy`

**Description**: Allows read/write access to the tamil-web-media bucket for storing images and audio files.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning"
      ],
      "Resource": "arn:aws:s3:::tamil-web-media"
    },
    {
      "Sid": "S3ObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject",
        "s3:GetObjectAcl",
        "s3:DeleteObject",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::tamil-web-media/*"
    },
    {
      "Sid": "S3BucketCreation",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:PutBucketCORS",
        "s3:GetBucketCORS",
        "s3:PutBucketPolicy",
        "s3:GetBucketPolicy",
        "s3:PutBucketPublicAccessBlock",
        "s3:GetBucketPublicAccessBlock"
      ],
      "Resource": "arn:aws:s3:::tamil-web-media"
    }
  ]
}
```

---

## 3. Cognito Policy

**Policy Name**: `PooVaasam-Cognito-Policy`

**Description**: Allows management of Cognito User Pools for authentication.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CognitoUserPoolAccess",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminDeleteUser",
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminListGroupsForUser",
        "cognito-idp:AdminAddUserToGroup",
        "cognito-idp:AdminRemoveUserFromGroup",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:ListUsers",
        "cognito-idp:ListGroups",
        "cognito-idp:CreateGroup",
        "cognito-idp:DeleteGroup",
        "cognito-idp:GetGroup",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:ListUserPools"
      ],
      "Resource": "arn:aws:cognito-idp:us-east-1:*:userpool/*"
    },
    {
      "Sid": "CognitoUserPoolCreation",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:CreateUserPool",
        "cognito-idp:DeleteUserPool",
        "cognito-idp:UpdateUserPool",
        "cognito-idp:CreateUserPoolClient",
        "cognito-idp:DeleteUserPoolClient",
        "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:ListUserPoolClients"
      ],
      "Resource": "arn:aws:cognito-idp:us-east-1:*:userpool/*"
    },
    {
      "Sid": "CognitoIdentityPoolAccess",
      "Effect": "Allow",
      "Action": [
        "cognito-identity:CreateIdentityPool",
        "cognito-identity:DeleteIdentityPool",
        "cognito-identity:UpdateIdentityPool",
        "cognito-identity:DescribeIdentityPool",
        "cognito-identity:ListIdentityPools",
        "cognito-identity:GetIdentityPoolRoles",
        "cognito-identity:SetIdentityPoolRoles"
      ],
      "Resource": "arn:aws:cognito-identity:us-east-1:*:identitypool/*"
    }
  ]
}
```

---

## 4. AWS Amplify Policy

**Policy Name**: `PooVaasam-Amplify-Policy`

**Description**: Allows AWS Amplify to deploy and manage the Next.js application.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AmplifyAppAccess",
      "Effect": "Allow",
      "Action": [
        "amplify:CreateApp",
        "amplify:DeleteApp",
        "amplify:GetApp",
        "amplify:ListApps",
        "amplify:UpdateApp",
        "amplify:CreateBranch",
        "amplify:DeleteBranch",
        "amplify:GetBranch",
        "amplify:ListBranches",
        "amplify:UpdateBranch",
        "amplify:StartJob",
        "amplify:StopJob",
        "amplify:GetJob",
        "amplify:ListJobs"
      ],
      "Resource": "arn:aws:amplify:us-east-1:*:apps/*"
    },
    {
      "Sid": "AmplifyBackendEnvironment",
      "Effect": "Allow",
      "Action": [
        "amplify:CreateBackendEnvironment",
        "amplify:DeleteBackendEnvironment",
        "amplify:GetBackendEnvironment",
        "amplify:ListBackendEnvironments",
        "amplify:UpdateBackendEnvironment"
      ],
      "Resource": "arn:aws:amplify:us-east-1:*:apps/*/backendenvironments/*"
    }
  ]
}
```

---

## 5. CloudWatch Logs Policy

**Policy Name**: `PooVaasam-CloudWatch-Policy`

**Description**: Allows logging and monitoring.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudWatchLogsAccess",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:us-east-1:*:log-group:/aws/amplify/*",
        "arn:aws:logs:us-east-1:*:log-group:/aws/lambda/PooVaasam*"
      ]
    }
  ]
}
```

---

## 6. IAM Policy (for Amplify to create roles)

**Policy Name**: `PooVaasam-IAM-Policy`

**Description**: Allows Amplify to create and manage IAM roles.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "IAMRoleCreation",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies"
      ],
      "Resource": [
        "arn:aws:iam::*:role/amplify-*",
        "arn:aws:iam::*:role/PooVaasam*"
      ]
    },
    {
      "Sid": "IAMPolicyManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:ListPolicies",
        "iam:ListPolicyVersions"
      ],
      "Resource": "arn:aws:iam::*:policy/PooVaasam*"
    }
  ]
}
```

---

## 7. Lambda Policy (Optional - if using Lambda functions)

**Policy Name**: `PooVaasam-Lambda-Policy`

**Description**: Allows creation and management of Lambda functions.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaFunctionAccess",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:ListFunctions",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:InvokeFunction",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy"
      ],
      "Resource": "arn:aws:lambda:us-east-1:*:function:PooVaasam*"
    },
    {
      "Sid": "LambdaLayerAccess",
      "Effect": "Allow",
      "Action": [
        "lambda:PublishLayerVersion",
        "lambda:DeleteLayerVersion",
        "lambda:GetLayerVersion",
        "lambda:ListLayers",
        "lambda:ListLayerVersions"
      ],
      "Resource": "arn:aws:lambda:us-east-1:*:layer:PooVaasam*"
    }
  ]
}
```

---

## 8. CloudFront Policy (for CDN)

**Policy Name**: `PooVaasam-CloudFront-Policy`

**Description**: Allows CloudFront distribution management for fast content delivery.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFrontAccess",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateDistribution",
        "cloudfront:DeleteDistribution",
        "cloudfront:GetDistribution",
        "cloudfront:GetDistributionConfig",
        "cloudfront:ListDistributions",
        "cloudfront:UpdateDistribution",
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation",
        "cloudfront:ListInvalidations"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 9. Systems Manager Parameter Store Policy

**Policy Name**: `PooVaasam-SSM-Policy`

**Description**: Allows storing and retrieving configuration parameters securely.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SSMParameterAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:PutParameter",
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
        "ssm:DeleteParameter",
        "ssm:DescribeParameters"
      ],
      "Resource": "arn:aws:ssm:us-east-1:*:parameter/poovaasam/*"
    }
  ]
}
```

---

## 10. Combined Development Policy (All-in-One)

**Policy Name**: `PooVaasam-Development-FullAccess`

**Description**: Combined policy for development environment (use with caution in production).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DynamoDBFullAccess",
      "Effect": "Allow",
      "Action": "dynamodb:*",
      "Resource": [
        "arn:aws:dynamodb:us-east-1:*:table/TamilWebContent",
        "arn:aws:dynamodb:us-east-1:*:table/TamilWebContent/*"
      ]
    },
    {
      "Sid": "S3FullAccess",
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::tamil-web-media",
        "arn:aws:s3:::tamil-web-media/*"
      ]
    },
    {
      "Sid": "CognitoFullAccess",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:*",
        "cognito-identity:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AmplifyFullAccess",
      "Effect": "Allow",
      "Action": "amplify:*",
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogsFullAccess",
      "Effect": "Allow",
      "Action": "logs:*",
      "Resource": "arn:aws:logs:us-east-1:*:log-group:/aws/amplify/*"
    },
    {
      "Sid": "LambdaFullAccess",
      "Effect": "Allow",
      "Action": "lambda:*",
      "Resource": "arn:aws:lambda:us-east-1:*:function:PooVaasam*"
    },
    {
      "Sid": "IAMLimitedAccess",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:PassRole",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy"
      ],
      "Resource": [
        "arn:aws:iam::*:role/amplify-*",
        "arn:aws:iam::*:role/PooVaasam*"
      ]
    }
  ]
}
```

---

## Setup Instructions

### Step 1: Create IAM User

1. Go to AWS IAM Console
2. Click **Users** → **Add users**
3. User name: `poovaasam-deployer`
4. Access type: **Programmatic access** ✓

### Step 2: Attach Policies

**Option A: Individual Policies (Recommended for Production)**
- Attach each policy (1-9) individually
- More granular control
- Better security

**Option B: Combined Policy (For Development)**
- Attach policy #10 only
- Faster setup
- Use for development/testing only

### Step 3: Save Credentials

After creating the user, save:
- Access Key ID
- Secret Access Key

**Add to `.env.local`:**
```bash
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
AWS_REGION=us-east-1
```

### Step 4: Configure Amplify CLI

```bash
amplify configure
```

Follow the prompts and use the credentials you just created.

---

## Resource ARN Patterns

Replace these placeholders in the policies:

- `*` in account ID → Your AWS Account ID (12 digits)
- `us-east-1` → Your preferred region
- `tamil-web-media` → Your S3 bucket name
- `TamilWebContent` → Your DynamoDB table name

### Example:
```json
// Before:
"Resource": "arn:aws:dynamodb:us-east-1:*:table/TamilWebContent"

// After:
"Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/TamilWebContent"
```

---

## Security Best Practices

1. **Never commit AWS credentials** to git
2. **Use IAM roles** for EC2/Lambda instead of access keys when possible
3. **Enable MFA** for IAM users
4. **Rotate access keys** regularly (every 90 days)
5. **Use least privilege** - start with minimal permissions, add as needed
6. **Monitor CloudTrail** for unusual API activity
7. **Use AWS Secrets Manager** for sensitive data
8. **Enable CloudWatch alarms** for unusual activity

---

## Cost Estimation

With these policies, your monthly AWS costs should be:

- **DynamoDB**: $10-30 (on-demand pricing)
- **S3**: $5-20 (depends on media storage)
- **Cognito**: Free (first 50,000 MAUs)
- **Amplify**: $15-50 (build minutes + hosting)
- **CloudFront**: $5-15 (data transfer)
- **CloudWatch**: $3-10 (logs)

**Total Estimated**: $38-145/month

Free tier benefits apply for the first 12 months!

---

## Troubleshooting

### Access Denied Errors

If you get "Access Denied" errors:

1. Check the policy has the correct action
2. Verify the resource ARN matches exactly
3. Ensure the user has the policy attached
4. Check for explicit deny statements
5. Wait 1-2 minutes for IAM propagation

### Common Issues

**DynamoDB Access Denied:**
```bash
# Check table ARN
aws dynamodb describe-table --table-name TamilWebContent
```

**S3 Access Denied:**
```bash
# Check bucket policy
aws s3api get-bucket-policy --bucket tamil-web-media
```

**Cognito Access Denied:**
```bash
# List user pools
aws cognito-idp list-user-pools --max-results 10
```

---

## Next Steps

After setting up these policies:

1. ✅ Configure AWS credentials locally
2. ✅ Initialize Amplify project
3. ✅ Create DynamoDB table
4. ✅ Create S3 bucket
5. ✅ Set up Cognito user pool
6. ✅ Deploy to Amplify

Need help with any of these steps? Let me know! 🚀
