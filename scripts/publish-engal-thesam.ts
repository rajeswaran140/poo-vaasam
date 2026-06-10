/**
 * One-off: publish the song "எங்கள் தேசம் என்றென்றும் ஒன்று" to the LIVE
 * ca-central-1 TamilWebContent table, using the app's own CreateContentUseCase
 * (so slug / GSI keys / the atomic create transaction all match the app), then
 * set its theme. Idempotent: skips if a song with this title is already published.
 *
 *   Dry run:  AWS_REGION=ca-central-1 MEDIA_BASE_URL=https://d2cdoh43143xxa.cloudfront.net npx tsx scripts/publish-engal-thesam.ts
 *   Publish:  WRITE=1 AWS_REGION=ca-central-1 MEDIA_BASE_URL=https://d2cdoh43143xxa.cloudfront.net npx tsx scripts/publish-engal-thesam.ts
 */

import { ContentRepository } from '@/infrastructure/database/ContentRepository';
import { CategoryRepository } from '@/infrastructure/database/CategoryRepository';
import { TagRepository } from '@/infrastructure/database/TagRepository';
import { CreateContentUseCase } from '@/application/use-cases/CreateContentUseCase';
import { setSongTheme } from '@/lib/song-theme-write';
import { ContentType, ContentStatus } from '@/types/content';

const WRITE = process.env.WRITE === '1';
const CDN = (process.env.MEDIA_BASE_URL || 'https://d2cdoh43143xxa.cloudfront.net').replace(/\/+$/, '');

// Encode each path segment but keep the '/', matching the existing songs' URLs.
const cdnUrl = (key: string) => `${CDN}/${key.split('/').map(encodeURIComponent).join('/')}`;

const TITLE = 'எங்கள் தேசம் என்றென்றும் ஒன்று';
const AUTHOR = 'இராஜ்';
const THEME = 'homeland';
const AUDIO_KEY = 'audio/poem-music/எங்கள் தேசம்.mp3';
const COVER_KEY = 'images/song-covers/engal-thesam.png';
const DURATION = 336; // seconds (5:36), from the MP3 header
// Honest placeholder — replace with the real lyrics in Admin → Content.
const BODY = `${TITLE}\n\n(பாடல் வரிகள் விரைவில் சேர்க்கப்படும்.)`;

async function main() {
  const contentRepo = new ContentRepository();
  const useCase = new CreateContentUseCase(contentRepo, new CategoryRepository(), new TagRepository());

  // Idempotency guard — don't create a duplicate if it's already published.
  const target = TITLE.trim().toLowerCase();
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await contentRepo.findByType(ContentType.SONGS, {
      status: ContentStatus.PUBLISHED,
      limit: 100,
      lastEvaluatedKey: cursor,
    });
    const dup = page.items.find((c) => (c.toObject().title ?? '').trim().toLowerCase() === target);
    if (dup) {
      console.log(`ALREADY PUBLISHED: ${TITLE} (id=${dup.toObject().id}) — nothing to do.`);
      return;
    }
    cursor = page.lastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);

  const audioUrl = cdnUrl(AUDIO_KEY);
  const featuredImage = cdnUrl(COVER_KEY);

  console.log(`mode=${WRITE ? 'WRITE' : 'DRY-RUN'}`);
  console.log(`  title:     ${TITLE}`);
  console.log(`  author:    ${AUTHOR}`);
  console.log(`  theme:     ${THEME}`);
  console.log(`  duration:  ${DURATION}s`);
  console.log(`  audioUrl:  ${audioUrl}`);
  console.log(`  cover:     ${featuredImage}`);

  if (!WRITE) {
    console.log('\nDry run — pass WRITE=1 to create.');
    return;
  }

  const content = await useCase.execute({
    type: ContentType.SONGS,
    title: TITLE,
    body: BODY,
    description: '',
    author: AUTHOR,
    status: ContentStatus.PUBLISHED,
    categoryIds: [],
    tagIds: [],
    audioUrl,
    audioDuration: DURATION,
    featuredImage,
  });

  const id = content.toObject().id as string;
  await setSongTheme(id, THEME);

  console.log(`\nCREATED id=${id}`);
  console.log(`Page: https://tamilagaval.com/content/${id}`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
