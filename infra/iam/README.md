# IAM — gated performer assets

## `performer-assets-getobject.json`

Grants the app's **runtime** IAM identity (`APP_AWS_*`) read access to the gated
karaoke bucket so the server-side stream route
(`GET /api/performers/songs/[id]/track`, behind `requirePerformer`) can
`GetObject` the instrumental. Least-privilege: read-only, single bucket.

- **Not applied by code** — this is the auditable source of the grant. Apply it
  as a deliberate, separate step, ideally right before the go-live playback test.
- The offline publisher identity (`mobily-web`) can already write to the bucket;
  this covers only the runtime **read**.
- The gated bucket (`tamil-web-media-gated`) is us-east-1 — see the region
  decision in `docs/KARAOKE_STEM_PIPELINE.md`. IAM ARNs are region-agnostic, so
  this policy is unaffected by the bucket's region.

### Identify the app user (without printing the secret) and attach

```bash
AKID=$(aws amplify get-app --app-id d3rkmepk4popv0 --region ca-central-1 \
  --query 'app.environmentVariables.APP_AWS_ACCESS_KEY_ID' --output text)
APP_USER=$(for u in $(aws iam list-users --query 'Users[].UserName' --output text); do
  aws iam list-access-keys --user-name "$u" \
    --query "AccessKeyMetadata[?AccessKeyId=='$AKID'].UserName" --output text; done | grep .)
echo "App user: $APP_USER"

aws iam put-user-policy --user-name "$APP_USER" \
  --policy-name PerformerGatedInstrumentalRead \
  --policy-document file://infra/iam/performer-assets-getobject.json
```
