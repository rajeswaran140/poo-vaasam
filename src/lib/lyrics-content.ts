/**
 * Raw content reads for the lyrics gate.
 *
 * These read the DynamoDB content item RAW (not through the Content domain
 * entity) because the gate needs the `showLyrics` flag and the raw `body`, and
 * we deliberately keep the domain layer untouched. A song's lyrics are shown on
 * the /lyrics pages only when it is PUBLISHED, has a non-empty `body`, and an
 * admin has explicitly flipped `showLyrics` on.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

/** The raw content attributes the lyrics feature relies on. */
export interface RawSongItem {
  id: string;
  title: string;
  titleSlug?: string;
  body?: string;
  featuredImage?: string;
  status?: string;
  type?: string;
  showLyrics?: boolean;
  /** Which upload the lyrics belong to — the join the caption module needs. */
  youtubeVideoId?: string;
  [key: string]: unknown;
}

/** Normalise a raw DynamoDB item into the fields the lyrics feature uses. */
export function toRawSong(item: Record<string, unknown>): RawSongItem {
  return {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    titleSlug: typeof item.titleSlug === 'string' ? item.titleSlug : undefined,
    body: typeof item.body === 'string' ? item.body : undefined,
    featuredImage: typeof item.featuredImage === 'string' ? item.featuredImage : undefined,
    status: typeof item.status === 'string' ? item.status : undefined,
    type: typeof item.type === 'string' ? item.type : undefined,
    showLyrics: item.showLyrics === true,
    youtubeVideoId: typeof item.youtubeVideoId === 'string' ? item.youtubeVideoId : undefined,
  };
}

/** True when a raw item is a published song whose lyrics are cleared for showing. */
export function lyricsVisible(item: RawSongItem | null | undefined): boolean {
  return (
    !!item &&
    item.status === 'PUBLISHED' &&
    item.showLyrics === true &&
    typeof item.body === 'string' &&
    item.body.trim().length > 0
  );
}

/** Read one content item RAW by id (PK=CONTENT#<id>, SK=METADATA). */
export async function getRawSongById(id: string): Promise<RawSongItem | null> {
  const item = await DynamoDBOperations.get({ PK: `CONTENT#${id}`, SK: 'METADATA' });
  return item ? toRawSong(item) : null;
}

/**
 * Clean ASCII aliases for share-friendly lyrics URLs. Tamil titleSlugs are
 * fragile in links (copy/paste + some clients mangle the Unicode), so we map a
 * tidy `/lyrics/<alias>` to the song id. Keep keys lowercase ASCII.
 */
export const LYRICS_VANITY: Record<string, string> = {
  thayagam: 'cnt_1781049094952_wstyqacm4', // எங்கள் தேசம்
};

/** Resolve one content item RAW by its titleSlug via GSI5 (or a vanity alias). */
export async function getRawSongBySlug(slug: string): Promise<RawSongItem | null> {
  const vanityId = LYRICS_VANITY[slug.trim().toLowerCase()];
  if (vanityId) return getRawSongById(vanityId);

  const res = await DynamoDBOperations.query({
    indexName: 'GSI5',
    keyConditionExpression: 'GSI5PK = :p AND GSI5SK = :slug',
    expressionAttributeValues: { ':p': 'SLUG', ':slug': slug },
    limit: 1,
  });
  const item = (res.Items || [])[0];
  return item ? toRawSong(item) : null;
}

/**
 * List all published SONGS RAW via GSI1 (CONTENT#SONGS). Used by the admin
 * lyrics manager and the build-time /lyrics index. Pages through the index so
 * the list never truncates.
 */
export async function listRawSongs(): Promise<RawSongItem[]> {
  const items: RawSongItem[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await DynamoDBOperations.query({
      indexName: 'GSI1',
      keyConditionExpression: 'GSI1PK = :type',
      expressionAttributeValues: { ':type': 'CONTENT#SONGS' },
      exclusiveStartKey,
    });
    for (const item of res.Items || []) items.push(toRawSong(item));
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return items;
}

/** Published songs whose lyrics are cleared to show on the public /lyrics pages. */
export async function listLyricsSongs(): Promise<RawSongItem[]> {
  return (await listRawSongs()).filter(lyricsVisible);
}
