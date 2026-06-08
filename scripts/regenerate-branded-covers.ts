/**
 * Regenerate the "branded" song covers (flat orange title-card templates,
 * ~160KB) as real painterly AI-art via the same prod pipeline the publish flow
 * uses (generateSongCover → gpt-image-1 → S3 → featuredImage).
 *
 * Branded covers are detected by S3 object size: the templates are ~160KB while
 * the gpt-image-1 covers are ~2.5-3MB, so a 400KB threshold separates them
 * cleanly. Idempotent: once a cover is regenerated (large), re-runs skip it.
 * Runs LOCALLY (the on-demand admin Cover button 504s — gpt-image-1 ~45s vs
 * Amplify's 30s gateway). After a WRITE run, redeploy so /songs (build-time)
 * shows the new covers.
 *
 *   Dry run:  AWS_REGION=ca-central-1 npx tsx --env-file=.env.local scripts/regenerate-branded-covers.ts
 *   Write:    WRITE=1 AWS_REGION=ca-central-1 npx tsx --env-file=.env.local scripts/regenerate-branded-covers.ts
 *   Options:  THRESHOLD=400000   (bytes; covers smaller than this are treated as branded)
 */

import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { ContentType, ContentStatus } from '@/types/content';
import { generateSongCover } from '@/application/use-cases/GenerateSongCover';

const WRITE = process.env.WRITE === '1';
const THRESHOLD = Number(process.env.THRESHOLD || 400_000);
const BUCKET = process.env.S3_BUCKET || 'tamil-web-media';
const s3 = new S3Client({ region: 'us-east-1' });

/** Object key from a featuredImage URL (CDN or S3), percent-decoded. */
function keyFromUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

async function sizeOf(key: string): Promise<number | null> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return r.ContentLength ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const repo = new ContentRepository();
  const page = await repo.findByType(ContentType.SONGS, { status: ContentStatus.PUBLISHED, limit: 300 });
  console.log(`mode=${WRITE ? 'WRITE' : 'DRY-RUN'}  threshold=${THRESHOLD}B  songs=${page.items.length}`);

  const targets: Array<{ id: string; title: string; size: number }> = [];
  for (const c of page.items) {
    const o = c.toObject() as Record<string, unknown>;
    const url = String(o.featuredImage || '');
    if (!url) { console.log(`  no-cover : ${String(o.title)}`); continue; }
    const key = keyFromUrl(url);
    const size = key ? await sizeOf(key) : null;
    if (size != null && size < THRESHOLD) {
      targets.push({ id: String(o.id), title: String(o.title), size });
    }
  }

  console.log(`\n${targets.length} branded cover(s) to regenerate:`);
  for (const t of targets) console.log(`  ${(t.size / 1024).toFixed(0).padStart(4)}KB  ${t.title}  (${t.id})`);
  if (!WRITE) { console.log('\n(dry-run) re-run with WRITE=1 to regenerate.'); return; }

  let done = 0;
  for (const t of targets) {
    process.stdout.write(`\nREGEN: ${t.title} ... `);
    const res = await generateSongCover(t.id);
    if (res.ok) { done++; console.log(`done -> ${res.featuredImage}`); }
    else console.error(`FAILED (${res.status}): ${res.error}`);
  }
  console.log(`\nregenerated ${done}/${targets.length}.${done ? ' Now redeploy Amplify.' : ''}`);
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
