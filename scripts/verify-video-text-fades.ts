/**
 * Proof for the Video Text fades: runs the real chunk command (buildChunkArgs)
 * through an ffmpeg — use the Lambda layer's 7.0.2 — at several frame rates,
 * and compares every frame's alpha with the preview's fadeAlphaAt.
 *
 * Run: npx tsx scripts/verify-video-text-fades.ts /path/to/layer/bin/ffmpeg <empty work dir>
 * Get the layer: aws lambda get-layer-version --layer-name tamilagaval-ffmpeg
 *   --version-number 1 --region ca-central-1 --query Content.Location
 *
 * Expect: frames = 4 s × fps (none dropped), blink false, rampMonotone true,
 * worst |Δα| ≲ 0.2 (sub-frame phase: the overlay shows the latest clip frame).
 */
import { execFileSync } from 'node:child_process';
import { buildChunkArgs, overlaysForSegment } from '../src/lib/video-text/render-plan';
import { fadeAlphaAt, fadeSecFor } from '../src/lib/video-text/fonts';
const [F, dir] = process.argv.slice(2);
const ff = (a: string[]) => execFileSync(F, ['-v', 'error', ...a]);
ff(['-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=64x64,format=rgba', '-f', 'lavfi', '-i', 'color=c=white@1.0:s=32x32,format=rgba', '-filter_complex', '[0][1]overlay=16:16', '-frames:v', '1', `${dir}/w.png`]);
for (const [fps, start, end, seg] of [[60, 1.0, 3.0, [0, 4]], [29.97, 1.23, 2.81, [0, 4]], [25, 1.23, 2.81, [0, 4]], [25, 3.87, 5.5, [4, 8]], [60, 1.0, 1.5, [0, 4]]] as [number, number, number, number[]][]) {
  ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=64x64:r=${fps}:d=4`, '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', `${dir}/s.mp4`]);
  const block = { id: 'a', startSec: start, endSec: end, fadeSec: fadeSecFor({ startSec: start, endSec: end }) };
  const ovs = overlaysForSegment([block], { startSec: seg[0], endSec: seg[1] });
  if (!ovs.length) { console.log(fps, 'no overlay'); continue; }
  const args = buildChunkArgs({ segPath: `${dir}/s.mp4`, overlays: ovs.map((o) => ({ ...o, path: `${dir}/w.png` })), width: 64, height: 64, outPath: `${dir}/o.mp4`, crf: 0, preset: 'veryfast', fps });
  ff(args.map((a) => (a === 'yuv420p' ? 'yuv444p' : a)));
  const ys = execFileSync(F, ['-v', 'error', '-i', `${dir}/o.mp4`, '-vf', 'crop=8:8:28:28,format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-']).toString()
    .split('\n').filter((l) => l.includes('YAVG')).map((l) => Number(l.split('=')[1]));
  let worst = 0; let blink = false; let prev = -1; let rising = true;
  ys.forEach((y, i) => {
    const t = seg[0] + i / fps;
    const want = fadeAlphaAt(block, true, t);
    const got = Math.max(0, (y - 16) / 219);
    worst = Math.max(worst, Math.abs(got - want));
    if (want > 0.2 && got < 0.02) blink = true;
    if (t > block.startSec + 0.05 && t < block.startSec + block.fadeSec - 0.02 && got < prev - 0.01) rising = false;
    prev = got;
  });
  console.log(`fps ${fps} block ${start}-${end} seg ${seg}: frames ${ys.length} worst |Δα| ${worst.toFixed(3)} blink ${blink} rampMonotone ${rising}`);
}
