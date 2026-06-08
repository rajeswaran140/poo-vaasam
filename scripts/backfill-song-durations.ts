/**
 * Backfill audioDuration (seconds) for SONGS that don't have it, so the /songs
 * list and the hero "X நிமிடம்" total show a duration for every track.
 *
 * Reads each song's audioUrl, loads it in headless Chromium and reads the
 * HTMLAudioElement duration from metadata (range requests — no full download),
 * then writes audioDuration to the live ca-central-1 TamilWebContent table.
 *
 *   Dry run (default):  AWS_REGION=ca-central-1 npx tsx scripts/backfill-song-durations.ts
 *   Write for real:     WRITE=1 AWS_REGION=ca-central-1 npx tsx scripts/backfill-song-durations.ts
 *   Re-fill all:        FORCE=1 WRITE=1 AWS_REGION=ca-central-1 npx tsx scripts/backfill-song-durations.ts
 */

import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { chromium } from 'playwright';

const WRITE = process.env.WRITE === '1';
const FORCE = process.env.FORCE === '1';
const TABLE = process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || 'TamilWebContent';
const REGION = process.env.AWS_REGION || 'ca-central-1';

const db = new DynamoDBClient({ region: REGION });

type Song = { id: string; title: string; audioUrl: string; duration?: number };

async function listSongs(): Promise<Song[]> {
  const res = await db.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :t',
      ExpressionAttributeValues: { ':t': { S: 'CONTENT#SONGS' } },
      ProjectionExpression: 'id, title, audioUrl, audioDuration',
    })
  );
  return (res.Items || []).map((it) => ({
    id: it.id?.S || '',
    title: it.title?.S || '',
    audioUrl: it.audioUrl?.S || '',
    duration: it.audioDuration?.N ? Number(it.audioDuration.N) : undefined,
  }));
}

async function main() {
  console.log(`region=${REGION} table=${TABLE} mode=${WRITE ? 'WRITE' : 'DRY-RUN'}${FORCE ? ' FORCE' : ''}`);
  const songs = await listSongs();
  const todo = songs.filter((s) => s.audioUrl && (FORCE || !s.duration));
  console.log(`songs=${songs.length}  missing/forced=${todo.length}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  let updated = 0;
  for (const s of todo) {
    const page = await ctx.newPage();
    let secs: number | null = null;
    try {
      secs = await page.evaluate(
        (url) =>
          new Promise<number>((resolve, reject) => {
            const a = document.createElement('audio');
            a.preload = 'metadata';
            a.src = url;
            a.addEventListener('loadedmetadata', () => resolve(a.duration));
            a.addEventListener('error', () => reject(new Error('audio load error')));
            setTimeout(() => reject(new Error('timeout')), 30000);
          }),
        s.audioUrl
      );
    } catch (e) {
      console.log(`  SKIP ${s.title} — ${(e as Error).message}`);
      await page.close();
      continue;
    }
    await page.close();

    if (!secs || !Number.isFinite(secs) || secs <= 0) {
      console.log(`  SKIP ${s.title} — bad duration (${secs})`);
      continue;
    }
    const dur = Math.round(secs);
    console.log(`  ${WRITE ? 'SET' : 'PLAN'} ${s.title} -> ${dur}s (${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')})`);
    if (!WRITE) continue;

    await db.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { PK: { S: `CONTENT#${s.id}` }, SK: { S: 'METADATA' } },
        UpdateExpression: 'SET audioDuration = :d',
        ExpressionAttributeValues: { ':d': { N: String(dur) } },
      })
    );
    updated++;
  }
  await browser.close();
  console.log(`done${WRITE ? ` — updated ${updated}` : ''}`);
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
