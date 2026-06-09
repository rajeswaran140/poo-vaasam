/**
 * Dedicated compose worker — runs OFF the Amplify SSR Lambda.
 *
 * Amplify's managed compute has a ~30s execution ceiling and drops `after()`
 * background work, so Sonnet's ~33s brief can't run there. This standalone
 * Lambda (tamilagaval-compose-worker, 120s timeout) is invoked asynchronously by
 * POST /api/admin/compose with `{ jobId, lyrics, model }`. It runs the SAME
 * `composeFromLyrics` (bundled from src via esbuild — no logic drift) and writes
 * the result onto the COMPOSEJOB#<id> DynamoDB item, which the form polls.
 *
 * Build: npm run build:worker  →  worker-dist/index.js (handler: index.handler)
 */

import { composeFromLyrics } from '@/services/ai/composer';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';

interface ComposeJobEvent {
  jobId?: string;
  lyrics?: string;
  model?: string;
}

export const handler = async (event: ComposeJobEvent) => {
  const jobId = event?.jobId;
  const lyrics = event?.lyrics;
  if (!jobId || !lyrics) {
    console.error('[compose-worker] bad event', JSON.stringify({ hasJobId: !!jobId, hasLyrics: !!lyrics }));
    return { ok: false, error: 'jobId and lyrics are required' };
  }

  let patch:
    | { status: 'done'; result: unknown; error: null }
    | { status: 'error'; result: null; error: { code: string; message: string } };
  try {
    const result = await composeFromLyrics(lyrics, event.model ? { model: event.model } : {});
    patch = result.ok
      ? { status: 'done', result: result.data, error: null }
      : { status: 'error', result: null, error: { code: result.code, message: result.error } };
  } catch (err) {
    console.error('[compose-worker] unexpected error:', err instanceof Error ? err.message : String(err));
    patch = { status: 'error', result: null, error: { code: 'upstream', message: 'The AI service failed. Please try again.' } };
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: `COMPOSEJOB#${jobId}`, SK: 'METADATA' },
        // UpdateItem upserts — the start route creates the 'processing' item, but
        // this also self-heals if it's missing. Async Lambda invocations are
        // at-least-once, so guard the transition: only write when the job is
        // missing or still 'processing'. This makes the worker idempotent — a
        // duplicate/late retry can't overwrite an already-terminal result.
        UpdateExpression: 'SET #s = :s, #r = :r, #e = :e, updatedAt = :u',
        ConditionExpression: 'attribute_not_exists(PK) OR #s = :processing',
        ExpressionAttributeNames: { '#s': 'status', '#r': 'result', '#e': 'error' },
        ExpressionAttributeValues: {
          ':s': patch.status,
          ':r': patch.result,
          ':e': patch.error,
          ':u': new Date().toISOString(),
          ':processing': 'processing',
        },
      })
    );
  } catch (err) {
    // A concurrent/duplicate run already wrote a terminal result — that's fine.
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      console.info('[compose-worker] job already terminal, skipping write', JSON.stringify({ jobId }));
      return { ok: true, jobId, status: 'already-terminal' };
    }
    throw err;
  }

  console.info('[compose-worker] complete', JSON.stringify({ jobId, status: patch.status }));
  return { ok: true, jobId, status: patch.status };
};
