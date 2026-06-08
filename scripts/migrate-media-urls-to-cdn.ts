/**
 * Rewrite stored media URLs in DynamoDB from the direct S3 host to the media
 * CDN (CloudFront), so the S3 bucket can be locked private. Replaces only the
 * scheme+host prefix; the (already percent-encoded) object path is preserved.
 *
 * Scans every item and rewrites any string attribute whose value contains the
 * old S3 host (covers audioUrl, coverUrl/featuredImage, etc. without hardcoding
 * attribute names). Idempotent: once values are on the CDN host, re-runs are
 * no-ops.
 *
 *   Dry run:  MEDIA_BASE_URL=https://d2cdoh43143xxa.cloudfront.net AWS_REGION=ca-central-1 npx tsx scripts/migrate-media-urls-to-cdn.ts
 *   Write:    WRITE=1 MEDIA_BASE_URL=https://d2cdoh43143xxa.cloudfront.net AWS_REGION=ca-central-1 npx tsx scripts/migrate-media-urls-to-cdn.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const WRITE = process.env.WRITE === '1';
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';
const REGION = process.env.AWS_REGION || 'ca-central-1';
const NEW_BASE = (process.env.MEDIA_BASE_URL || '').replace(/\/+$/, '');

// Both the regioned and legacy host forms map to the same bucket.
const OLD_HOSTS = [
  'https://tamil-web-media.s3.us-east-1.amazonaws.com',
  'https://tamil-web-media.s3.amazonaws.com',
];

const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function rewrite(value: string): string | null {
  for (const host of OLD_HOSTS) {
    if (value.includes(host)) return value.split(host).join(NEW_BASE);
  }
  return null;
}

async function main() {
  if (!NEW_BASE) { console.error('Set MEDIA_BASE_URL (the CloudFront base URL).'); process.exit(1); }
  console.log(`mode=${WRITE ? 'WRITE' : 'DRY-RUN'}  table=${TABLE}  -> ${NEW_BASE}`);

  let ExclusiveStartKey: Record<string, unknown> | undefined;
  let scanned = 0, changedItems = 0, changedAttrs = 0;
  do {
    const page = await db.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    for (const item of page.Items ?? []) {
      scanned++;
      const updates: Record<string, string> = {};
      for (const [k, v] of Object.entries(item)) {
        if (k === 'PK' || k === 'SK') continue;
        if (typeof v !== 'string') continue;
        const nv = rewrite(v);
        if (nv && nv !== v) updates[k] = nv;
      }
      const keys = Object.keys(updates);
      if (!keys.length) continue;
      changedItems++; changedAttrs += keys.length;
      console.log(`  ${WRITE ? 'UPDATE' : 'PLAN  '} ${item.PK} | ${item.SK}`);
      for (const k of keys) console.log(`         ${k}: ${updates[k]}`);
      if (WRITE) {
        const names: Record<string, string> = {};
        const values: Record<string, string> = {};
        const sets = keys.map((k, i) => { names[`#a${i}`] = k; values[`:v${i}`] = updates[k]; return `#a${i} = :v${i}`; });
        await db.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: item.PK, SK: item.SK },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }));
      }
    }
    ExclusiveStartKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  console.log(`\nscanned ${scanned} items; ${changedAttrs} url attrs across ${changedItems} items ${WRITE ? 'updated' : 'to update'}.`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
