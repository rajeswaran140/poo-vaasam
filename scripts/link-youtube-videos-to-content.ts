/**
 * Smart auto-linker: fetch the YouTube channel's uploads, fuzzy-match each
 * one against the site's Content records (using the same matcher the
 * /admin/youtube page uses), and where the match is *unambiguous*, write
 * videoUrl + youtubeVideoId onto the content row.
 *
 * Conservative by design:
 *   - Never overwrites an existing non-empty videoUrl or youtubeVideoId
 *     (uses DynamoDB ConditionExpression for atomic safety).
 *   - Skips ambiguous matches (one video → >1 content rows) and unmatched
 *     videos. Those are surfaced for human review at the end.
 *   - Dry-run by default; WRITE=1 to actually persist.
 *
 *   Dry run (default):
 *     YOUTUBE_API_KEY=AIza... AWS_REGION=ca-central-1 npx tsx scripts/link-youtube-videos-to-content.ts
 *
 *   Write for real:
 *     WRITE=1 YOUTUBE_API_KEY=AIza... AWS_REGION=ca-central-1 npx tsx scripts/link-youtube-videos-to-content.ts
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  fetchChannelVideoStats,
  isYouTubeApiConfigured,
} from '../src/lib/youtube-api';
import { videoMatchesContent } from '../src/lib/youtube-match';
import { SITE } from '../src/config/site';

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

interface Plan {
  contentId: string;
  contentTitle: string;
  videoId: string;
  videoTitle: string;
  setVideoUrl: boolean;       // true when videoUrl is currently empty
  setYoutubeVideoId: boolean; // true when youtubeVideoId is currently empty
}

async function main() {
  console.log(`region=${REGION} table=${TABLE} mode=${WRITE ? 'WRITE' : 'DRY-RUN'}`);

  if (!isYouTubeApiConfigured()) {
    console.error('FAILED: YOUTUBE_API_KEY is not set in the environment.');
    process.exit(1);
  }

  const [channelVideos, content] = await Promise.all([
    fetchChannelVideoStats(SITE.youtube.channelId, 50),
    listContent(),
  ]);
  console.log(`channel videos: ${channelVideos.length}`);
  console.log(`content rows:   ${content.length}`);

  const plans: Plan[] = [];
  const ambiguous: { videoId: string; videoTitle: string; matched: string[] }[] = [];
  const unmatched: { videoId: string; videoTitle: string }[] = [];

  for (const v of channelVideos) {
    const matches = content.filter((c) => videoMatchesContent(v, c));
    if (matches.length === 0) {
      unmatched.push({ videoId: v.id, videoTitle: v.title });
      continue;
    }
    if (matches.length > 1) {
      ambiguous.push({
        videoId: v.id,
        videoTitle: v.title,
        matched: matches.map((m) => `${m.title} (${m.id})`),
      });
      continue;
    }
    const m = matches[0];
    const watchUrl = `https://www.youtube.com/watch?v=${v.id}`;
    const setVideoUrl = !m.videoUrl;
    const setYoutubeVideoId = !m.youtubeVideoId;
    if (!setVideoUrl && !setYoutubeVideoId) {
      // Already fully linked — nothing to do.
      continue;
    }
    plans.push({
      contentId: m.id,
      contentTitle: m.title,
      videoId: v.id,
      videoTitle: v.title,
      setVideoUrl,
      setYoutubeVideoId,
    });
    console.log(
      `  ${WRITE ? 'SET' : 'PLAN'} "${m.title}" -> ${v.id}` +
        ` (${setVideoUrl ? '+videoUrl' : 'keep videoUrl'},` +
        ` ${setYoutubeVideoId ? '+youtubeVideoId' : 'keep youtubeVideoId'})`
    );

    if (!WRITE) continue;

    // Build the SET expression dynamically — only touch the fields that
    // are currently empty, and gate each with a ConditionExpression so a
    // concurrent admin edit can't be silently clobbered.
    const sets: string[] = [];
    const conditions: string[] = [];
    const values: Record<string, { S: string }> = { ':empty': { S: '' } };
    if (setVideoUrl) {
      sets.push('videoUrl = :url');
      conditions.push('(attribute_not_exists(videoUrl) OR videoUrl = :empty)');
      values[':url'] = { S: watchUrl };
    }
    if (setYoutubeVideoId) {
      sets.push('youtubeVideoId = :ytid');
      conditions.push('(attribute_not_exists(youtubeVideoId) OR youtubeVideoId = :empty)');
      values[':ytid'] = { S: v.id };
    }

    try {
      await db.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: { PK: { S: `CONTENT#${m.id}` }, SK: { S: 'METADATA' } },
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: conditions.join(' AND '),
          ExpressionAttributeValues: values,
        })
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        console.log(`    RACE: ${m.title} — fields set since scan; skipped.`);
      } else {
        throw err;
      }
    }
  }

  console.log('\n--- summary ---');
  console.log(`planned updates: ${plans.length}`);
  if (ambiguous.length > 0) {
    console.log(`\nambiguous (skipped — link these by hand): ${ambiguous.length}`);
    for (const a of ambiguous) {
      console.log(`  ${a.videoId} "${a.videoTitle}" → matched: ${a.matched.join('; ')}`);
    }
  }
  if (unmatched.length > 0) {
    console.log(`\nunmatched videos (no site content page yet): ${unmatched.length}`);
    for (const u of unmatched) console.log(`  ${u.videoId} "${u.videoTitle}"`);
  }
  if (!WRITE) console.log('\nRe-run with WRITE=1 to apply.');
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
