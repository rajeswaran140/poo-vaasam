/**
 * One-off: generate an AI cover image for a POEM, upload it to S3, and set the
 * poem's `featuredImage` — same pipeline the song publish flow uses
 * (generateCoverArt → gpt-image-1 → S3 (tamil-web-media, CDN) → featuredImage),
 * but with a poem-appropriate prompt (the song use-case hard-codes "song").
 *
 * Runs LOCALLY (gpt-image-1 ~45s > Amplify's 30s gateway). After it writes,
 * /poems and /all are build-time, so redeploy to surface the new cover; the
 * /content detail page reads at request time.
 *
 *   Generate:  AWS_REGION=ca-central-1 npx tsx --env-file=.env.local scripts/generate-poem-cover.ts
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { generateCoverArt } from '@/services/ai/cover-art';

const ID = process.env.POEM_ID || 'cnt_1776894088077_lvojr2a18';

// "அம்மா...!" — a child's aching longing and remembrance of a departed mother
// (lakeshore, misty hills, tears as rain, eyelids becoming umbrellas). A
// tender, melancholic memory-scape; no faces (avoids uncanny AI portraits),
// no text, strictly apolitical.
const PROMPT =
  'A cinematic, emotionally evocative fine-art oil painting as the cover for a Tamil poem about a child\'s ' +
  'deep longing and remembrance of their mother. A serene South-Indian lakeside at golden dusk, soft mist over ' +
  'distant hills, gentle rain dimpling calm water, warm nostalgic light. A single lit clay oil lamp and an empty ' +
  'wooden bench by the water suggest tender absence and memory. Melancholic yet warm and loving mood, painterly ' +
  'brushwork, culturally Tamil aesthetic, soft natural light. No text, no lettering, no words, no human faces. ' +
  'Strictly apolitical — no flags, political symbols, parties, or partisan references.';

async function main() {
  const entity = await new ContentRepository().findById(ID);
  if (!entity) throw new Error(`Poem not found: ${ID}`);
  const o = entity.toObject() as Record<string, unknown>;
  console.log(`Poem : ${o.title}  (type=${o.type}, status=${o.status})`);
  if (o.featuredImage) console.log(`NOTE : already has a cover → ${o.featuredImage} (will overwrite)`);

  console.log('Generating cover via gpt-image-1 (~45s) ...');
  const gen = await generateCoverArt(PROMPT);
  if (!gen.ok) throw new Error(`Image generation failed: ${gen.error}`);

  const key = `images/poem-covers/${ID}-${Date.now()}.png`;
  const { url } = await S3Operations.uploadFile({
    key,
    file: Buffer.from(gen.base64, 'base64'),
    contentType: 'image/png',
  });
  console.log(`Uploaded → ${url}`);

  await DynamoDBOperations.update({
    key: { PK: `CONTENT#${ID}`, SK: 'METADATA' },
    updateExpression: 'SET featuredImage = :u, updatedAt = :t',
    expressionAttributeValues: { ':u': url, ':t': new Date().toISOString() },
    conditionExpression: 'attribute_exists(PK)',
  });
  console.log(`featuredImage set on CONTENT#${ID}. Redeploy to surface on /poems & /all.`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
