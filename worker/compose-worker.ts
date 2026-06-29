/**
 * Shared AI-job worker — runs OFF the Amplify SSR Lambda.
 *
 * Amplify's managed compute has a ~30s execution ceiling and drops `after()`
 * background work, so long Sonnet calls can't run there. This standalone Lambda
 * (tamilagaval-compose-worker, 120s timeout) is invoked asynchronously and runs
 * the SAME service code as the app (bundled from src via esbuild — no logic
 * drift), writing the result onto a `<KIND>JOB#<id>` DynamoDB item the form polls.
 *
 * It handles two job kinds (dispatched on `event.kind`, default 'compose' for
 * back-compat):
 *   - 'compose'  → composeFromLyrics  → COMPOSEJOB#<id>   (~33s brief)
 *   - 'critique' → critiqueLyric      → CRITICJOB#<id>    (~50-70s feedback)
 *
 * Build: npm run build:worker  →  worker-dist/index.js (handler: index.handler)
 */

import { composeFromLyrics } from '@/services/ai/composer';
import { critiqueLyric } from '@/services/ai/lyricCritic';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';

interface JobEvent {
  kind?: 'compose' | 'critique';
  jobId?: string;
  lyrics?: string;
  focus?: string[]; // critique only
  notes?: string; // critique only
  lexicon?: string[]; // critique only — poet's personal vocabulary hints
  model?: string;
}

type Patch =
  | { status: 'done'; result: unknown; error: null }
  | { status: 'error'; result: null; error: { code: string; message: string } };

export const handler = async (event: JobEvent) => {
  const kind = event?.kind === 'critique' ? 'critique' : 'compose';
  const jobId = event?.jobId;
  const lyrics = event?.lyrics;
  if (!jobId || !lyrics) {
    console.error('[ai-job-worker] bad event', JSON.stringify({ kind, hasJobId: !!jobId, hasLyrics: !!lyrics }));
    return { ok: false, error: 'jobId and lyrics are required' };
  }
  const pk = `${kind === 'critique' ? 'CRITICJOB' : 'COMPOSEJOB'}#${jobId}`;

  let patch: Patch;
  try {
    const result =
      kind === 'critique'
        ? await critiqueLyric(
            { lyrics, focus: event.focus ?? [], ...(event.notes ? { notes: event.notes } : {}) },
            {
              ...(event.model ? { model: event.model } : {}),
              ...(event.lexicon?.length ? { lexicon: event.lexicon } : {}),
            }
          )
        : await composeFromLyrics(lyrics, event.model ? { model: event.model } : {});
    patch = result.ok
      ? { status: 'done', result: result.data, error: null }
      : { status: 'error', result: null, error: { code: result.code, message: result.error } };
  } catch (err) {
    console.error(`[ai-job-worker:${kind}] unexpected error:`, err instanceof Error ? err.message : String(err));
    patch = { status: 'error', result: null, error: { code: 'upstream', message: 'The AI service failed. Please try again.' } };
  }

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pk, SK: 'METADATA' },
        // UpdateItem upserts — the start route creates the 'processing' item, but
        // this also self-heals if it's missing. Async Lambda invocations are
        // at-least-once, so guard the transition: only write when the job is
        // missing or still 'processing'. Idempotent — a duplicate/late retry can't
        // overwrite an already-terminal result.
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
      console.info(`[ai-job-worker:${kind}] job already terminal, skipping write`, JSON.stringify({ jobId }));
      return { ok: true, jobId, status: 'already-terminal' };
    }
    throw err;
  }

  console.info(`[ai-job-worker:${kind}] complete`, JSON.stringify({ jobId, status: patch.status }));
  return { ok: true, jobId, status: patch.status };
};
