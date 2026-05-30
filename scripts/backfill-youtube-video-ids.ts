/**
 * Backfill youtubeVideoId on Content records whose videoUrl carries a YouTube
 * link but whose dedicated youtubeVideoId field is empty. Purely additive —
 * no deletes, no overwrites of existing youtubeVideoId values, no touch to
 * any other field.
 *
 *   Dry run (default):  AWS_REGION=ca-central-1 npx tsx scripts/backfill-youtube-video-ids.ts
 *   Write for real:     WRITE=1 AWS_REGION=ca-central-1 npx tsx scripts/backfill-youtube-video-ids.ts
 *
 * Idempotent — re-running after WRITE=1 reports 0 updates because every
 * record now has youtubeVideoId set.
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { getYouTubeId } from '../src/lib/utils/youtube';

const WRITE = process.env.WRITE === '1';
const TABLE = process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || 'TamilWebContent';
const REGION = process.env.AWS_REGION || 'ca-central-1';

const db = new DynamoDBClient({ region: REGION });

interface Row {
  id: string;
  title: string;
  videoUrl: string;
  youtubeVideoId: string;
}

/**
 * Scan every Content METADATA row. A Scan is fine for tens-to-hundreds of
 * records and avoids relying on a GSI projection that may not include all
 * the fields we need.
 */
async function listContent(): Promise<Row[]> {
  const out: Row[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await db.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: '#type = :t',
        ExpressionAttributeNames: { '#type': 'Type' },
        ExpressionAttributeValues: { ':t': { S: 'CONTENT' } },
        ProjectionExpression: 'id, title, videoUrl, youtubeVideoId',
        ExclusiveStartKey: exclusiveStartKey as Record<string, never> | undefined,
      })
    );
    for (const it of res.Items ?? []) {
      out.push({
        id: it.id?.S ?? '',
        title: it.title?.S ?? '',
        videoUrl: it.videoUrl?.S ?? '',
        youtubeVideoId: it.youtubeVideoId?.S ?? '',
      });
    }
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return out;
}

async function main() {
  console.log(`region=${REGION} table=${TABLE} mode=${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  const rows = await listContent();
  console.log(`content rows scanned: ${rows.length}`);

  let updated = 0;
  let skippedAlreadySet = 0;
  let skippedNoVideoUrl = 0;
  let skippedNonYouTube = 0;

  for (const r of rows) {
    if (r.youtubeVideoId) {
      skippedAlreadySet++;
      continue;
    }
    if (!r.videoUrl) {
      skippedNoVideoUrl++;
      continue;
    }
    const id = getYouTubeId(r.videoUrl);
    if (!id) {
      skippedNonYouTube++;
      console.log(`  SKIP non-YouTube: ${r.title} (${r.videoUrl})`);
      continue;
    }

    console.log(`  ${WRITE ? 'SET' : 'PLAN'} ${r.title} -> youtubeVideoId=${id}`);
    if (!WRITE) continue;

    await db.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { PK: { S: `CONTENT#${r.id}` }, SK: { S: 'METADATA' } },
        // Guard with attribute_not_exists so we never overwrite a value
        // an admin has already set explicitly — this script is for
        // backfilling empties only.
        ConditionExpression: 'attribute_not_exists(youtubeVideoId) OR youtubeVideoId = :empty',
        UpdateExpression: 'SET youtubeVideoId = :id',
        ExpressionAttributeValues: { ':id': { S: id }, ':empty': { S: '' } },
      })
    ).catch((err) => {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        console.log(`  RACE on ${r.title} — youtubeVideoId set since scan; skipping.`);
      } else {
        throw err;
      }
    });
    updated++;
  }

  console.log(
    `done — ${WRITE ? 'updated' : 'would update'} ${updated} | ` +
      `already-set ${skippedAlreadySet} | no-videoUrl ${skippedNoVideoUrl} | non-YouTube ${skippedNonYouTube}`
  );
  if (!WRITE) console.log('Re-run with WRITE=1 to apply.');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
