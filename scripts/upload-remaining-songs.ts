/**
 * Publish SONGS content for every audio file in S3 that isn't a song yet.
 *
 * Lists s3://tamil-web-media/audio/poem-music/ (us-east-1), skips files whose
 * title is already a published song, and creates the rest via the admin
 * CreateContentUseCase (so slug / GSI keys match the app). Writes to the LIVE
 * ca-central-1 TamilWebContent table.
 *
 *   Dry run (default):  AWS_REGION=ca-central-1 npx tsx scripts/upload-remaining-songs.ts
 *   Write for real:     WRITE=1 AWS_REGION=ca-central-1 npx tsx scripts/upload-remaining-songs.ts
 */

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { ContentType, ContentStatus } from '@/types/content';

const WRITE = process.env.WRITE === '1';
const BUCKET = 'tamil-web-media';
const PREFIX = 'audio/poem-music/';
const S3_BASE = `https://${BUCKET}.s3.us-east-1.amazonaws.com`;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg)$/i;
const AUTHOR = 'இராஜ்';

const titleOf = (key: string) => (key.split('/').pop() || '').replace(AUDIO, '').trim();
// Encode each path segment but keep the '/'; matches the existing songs' URLs.
const urlOf = (key: string) => `${S3_BASE}/${key.split('/').map(encodeURIComponent).join('/')}`;
const bodyOf = (t: string) => `${t} — ஒலி வடிவப் பாடல். முழு வீடியோ YouTube-ல்.`;

async function main() {
  const s3 = new S3Client({ region: 'us-east-1' });
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
  const keys = (listed.Contents || []).map((o) => o.Key || '').filter((k) => AUDIO.test(k));

  const contentRepo = new ContentRepository();
  const useCase = new CreateContentUseCase(contentRepo, new CategoryRepository(), new TagRepository());

  const existing = await contentRepo.findByType(ContentType.SONGS, { limit: 200, status: ContentStatus.PUBLISHED });
  const have = new Set(existing.items.map((i) => i.toObject().title));

  console.log(`mode=${WRITE ? 'WRITE' : 'DRY-RUN'}  s3 audio files=${keys.length}  already published=${have.size}`);

  let created = 0;
  for (const key of keys) {
    const title = titleOf(key);
    if (have.has(title)) {
      console.log(`SKIP (exists): ${title}`);
      continue;
    }
    const audioUrl = urlOf(key);
    console.log(`${WRITE ? 'CREATE' : 'PLAN  '}: ${title}`);
    console.log(`        ${audioUrl}`);
    if (!WRITE) continue;

    const c = await useCase.execute({
      type: ContentType.SONGS,
      title,
      body: bodyOf(title),
      description: '',
      author: AUTHOR,
      status: ContentStatus.PUBLISHED,
      categoryIds: [],
      tagIds: [],
      audioUrl,
    });
    console.log(`        created id=${c.toObject().id}`);
    created++;
  }
  console.log(`done${WRITE ? ` — created ${created}` : ''}`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
