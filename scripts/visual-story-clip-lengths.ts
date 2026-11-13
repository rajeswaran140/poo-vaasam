/**
 * Record the real length of every made clip that has none (clips made before
 * 2026-11-13). Fit to the lyrics trims or slows a clip only when its length
 * is known; without it a clip is kept exactly at its row's whole seconds.
 *
 *   npx tsx scripts/visual-story-clip-lengths.ts          # dry run: lists what it would write
 *   npx tsx scripts/visual-story-clip-lengths.ts --write  # writes durationSec (hundredths)
 *
 * Reads each clip with ffprobe through a 10-minute signed URL (nothing is
 * downloaded whole). Each write is conditioned on durationSec still being
 * absent, so it never overwrites a length a new clip already carries.
 */
import { execFileSync } from 'node:child_process';
import { VisualStoryRepository, candSk, vsPk } from '@/infrastructure/database/VisualStoryRepository';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { S3Operations } from '@/infrastructure/storage/s3-client';
import { assemblyKindOf } from '@/lib/visual-story-assemble';

const write = process.argv.includes('--write');

function probeSec(url: string): number | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url], { timeout: 60_000 })
      .toString()
      .trim();
    const n = Number(out);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  } catch {
    return null;
  }
}

(async () => {
  const repo = new VisualStoryRepository();
  let found = 0;
  let wrote = 0;
  let failed = 0;
  for (const story of await repo.list()) {
    const tree = await repo.loadTree(story.vsId);
    if (!tree) continue;
    for (const c of tree.candidates) {
      if (c.mode === 'STILL' || typeof c.durationSec === 'number' || assemblyKindOf(c.s3Key) !== 'clip') continue;
      found++;
      const sec = probeSec(await S3Operations.getSignedUrl(c.s3Key, 600));
      if (sec === null) {
        failed++;
        console.log(`${story.vsId} ${c.candId} could not be read`);
        continue;
      }
      console.log(`${story.vsId} ${c.candId} (shot ${c.sceneOrder}.${c.shotOrder}) none → ${sec} s`);
      if (!write) continue;
      try {
        await DynamoDBOperations.update({
          key: { PK: vsPk(story.vsId), SK: candSk(c.sceneOrder, c.shotOrder, c.candId) },
          updateExpression: 'SET durationSec = :d',
          expressionAttributeValues: { ':d': sec },
          conditionExpression: 'attribute_exists(PK) AND attribute_not_exists(durationSec)',
        });
        wrote++;
      } catch (err) {
        failed++;
        console.log(`${story.vsId} ${c.candId} not written: ${err instanceof Error ? err.name : 'error'}`);
      }
    }
  }
  console.log(`${found} clip${found === 1 ? '' : 's'} without a length; ${write ? `${wrote} written` : 'dry run, nothing written'}; ${failed} failed.`);
})();
