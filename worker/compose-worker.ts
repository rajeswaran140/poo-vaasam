/**
 * Shared AI-job worker — runs OFF the Amplify SSR Lambda.
 *
 * Amplify's managed compute has a ~30s execution ceiling and drops `after()`
 * background work, so long Sonnet calls can't run there. This standalone Lambda
 * (tamilagaval-compose-worker, 120s timeout) is invoked asynchronously and runs
 * the SAME service code as the app (bundled from src via esbuild — no logic
 * drift), writing the result onto a `<KIND>JOB#<id>` DynamoDB item the form polls.
 *
 * It handles three job kinds (dispatched on `event.kind`, default 'compose' for
 * back-compat):
 *   - 'compose'    → composeFromLyrics   → COMPOSEJOB#<id>  (~33-41s brief)
 *   - 'critique'   → critiqueLyric       → CRITICJOB#<id>   (~50-70s feedback)
 *   - 'suno-setup' → generateSunoSetup   → SUNOJOB#<id>     (arrangement)
 *
 * ⚠️ 'suno-setup' shipped INLINE on the Amplify route first and 504'd on every
 * real song — the same ~30s wall that put compose and critique here. Do not move
 * any of them back.
 *
 * Build: npm run build:worker  →  worker-dist/index.js (handler: index.handler)
 */

import { composeFromLyrics } from '@/services/ai/composer';
import { critiqueLyric } from '@/services/ai/lyricCritic';
import { generateSunoSetup } from '@/services/ai/sunoSetup';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const TABLE = process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent';

// The AI service modules (composer/lyricCritic/sunoSetup) read Anthropic /
// Gemini keys from process.env at call time. Populate them once at cold start
// from SSM SecureString so no plaintext secrets live on the Lambda's env-var
// config (readable by anyone with lambda:GetFunctionConfiguration). Cached
// across warm invocations — the Promise is awaited in the handler.
const ssm = new SSMClient({ region: process.env.AWS_REGION || 'ca-central-1' });
async function ssmSecret(name: string): Promise<string> {
  const r = await ssm.send(
    new GetParameterCommand({ Name: `/tamilagaval/prod/${name}`, WithDecryption: true })
  );
  const v = r.Parameter?.Value;
  if (!v) throw new Error(`SSM /tamilagaval/prod/${name} missing or empty`);
  return v;
}
const secretsLoaded: Promise<void> = (async () => {
  const [anthropic, gemini] = await Promise.all([
    ssmSecret('ANTHROPIC_API_KEY'),
    ssmSecret('GEMINI_API_KEY'),
  ]);
  process.env.ANTHROPIC_API_KEY = anthropic;
  process.env.GEMINI_API_KEY = gemini;
})();

interface JobEvent {
  kind?: 'compose' | 'critique' | 'suno-setup';
  jobId?: string;
  lyrics?: string;
  focus?: string[]; // critique only
  notes?: string; // critique + suno-setup
  lexicon?: string[]; // critique only — poet's personal vocabulary hints
  model?: string;
  // suno-setup only — the chosen variant's musical direction. Breaks may only
  // name instruments from `instruments`, so it must reach the worker intact.
  style?: string;
  styleBrief?: string;
  instruments?: string[];
  ragas?: string[];
  voices?: string[];
  bpm?: number;
  key?: string;
  mood?: string;
}

type Patch =
  | { status: 'done'; result: unknown; error: null }
  | { status: 'error'; result: null; error: { code: string; message: string } };

export const handler = async (event: JobEvent) => {
  await secretsLoaded;
  const kind: NonNullable<JobEvent['kind']> =
    event?.kind === 'critique' ? 'critique' : event?.kind === 'suno-setup' ? 'suno-setup' : 'compose';
  const jobId = event?.jobId;
  const lyrics = event?.lyrics;
  if (!jobId || !lyrics) {
    console.error('[ai-job-worker] bad event', JSON.stringify({ kind, hasJobId: !!jobId, hasLyrics: !!lyrics }));
    return { ok: false, error: 'jobId and lyrics are required' };
  }
  const PK_PREFIX = { compose: 'COMPOSEJOB', critique: 'CRITICJOB', 'suno-setup': 'SUNOJOB' } as const;
  const pk = `${PK_PREFIX[kind]}#${jobId}`;

  let patch: Patch;
  try {
    if (kind === 'suno-setup') {
      // The setup carries its checks alongside the output — `ready:false` plus
      // findings is a useful answer, so the whole envelope is stored, not just
      // `data`. A contradiction is faster to fix by hand than to regenerate.
      const r = await generateSunoSetup({
        lyrics,
        style: event.style ?? '',
        ...(event.styleBrief ? { styleBrief: event.styleBrief } : {}),
        instruments: event.instruments ?? [],
        ragas: event.ragas ?? [],
        voices: event.voices ?? [],
        ...(event.bpm ? { bpm: event.bpm } : {}),
        ...(event.key ? { key: event.key } : {}),
        ...(event.mood ? { mood: event.mood } : {}),
        ...(event.notes ? { notes: event.notes } : {}),
      });
      patch = r.ok
        ? { status: 'done', result: { setup: r.data, findings: r.findings, ready: r.ready }, error: null }
        : { status: 'error', result: null, error: { code: r.code, message: r.error } };
    } else {
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
    }
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
