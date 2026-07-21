/**
 * generate-karaoke-stem — produce a subscriber-gated karaoke instrumental for a
 * song by separating its master's vocals out with Demucs.
 *
 * This is the CLI composition root: it wires the concrete adapters into the
 * GenerateKaraokeStem use case. Stem separation is heavy ML, so it runs here
 * (offline/batch), never in a request path.
 *
 *   # DRY RUN (default) — writes the instrumental locally, no S3/DynamoDB writes:
 *   npx tsx scripts/generate-karaoke-stem.ts \
 *     --song sevvanthi-poove \
 *     --audio https://d2cdoh43143xxa.cloudfront.net/audio/poem-music/செவ்வந்தி.mp3 \
 *     --out ~/karaoke/sevvanthi-instrumental.mp3
 *
 *   # PUBLISH — upload to the gated audio/karaoke/ prefix + record on the song:
 *   ... --publish            (omit --out; storage key is derived)
 *
 * Requirements: Python with `demucs` importable (pip install --user demucs) and
 * ffmpeg/ffprobe on PATH. Never publishes anything unless --publish is passed.
 */

import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GenerateKaraokeStem } from '@/application/use-cases/GenerateKaraokeStem';
import { DemucsStemSeparator } from '@/infrastructure/audio/DemucsStemSeparator';
import { S3KaraokeInstrumentalStorage } from '@/infrastructure/storage/KaraokeInstrumentalStorage';
import { DynamoKaraokeAssetRepository } from '@/infrastructure/database/DynamoKaraokeAssetRepository';
import type {
  SongMasterSource,
  KaraokeInstrumentalStorage,
  KaraokeAssetRepository,
} from '@/application/ports/karaoke';

interface Args {
  song: string;
  audio: string;
  out?: string;
  python?: string;
  model?: string;
  publish: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const song = get('--song');
  const audio = get('--audio');
  if (!song || !audio) {
    throw new Error('Usage: --song <id> --audio <master-url> [--out <path>] [--publish] [--python <bin>] [--model <name>]');
  }
  return {
    song,
    audio,
    out: get('--out'),
    python: get('--python'),
    model: get('--model'),
    publish: argv.includes('--publish'),
  };
}

/** Resolves a master (local path OR http(s) URL) into a local temp file named
 *  <songId>.mp3 — a clean, ASCII track name for the Demucs output directory. */
function masterSource(audio: string, workDir: string): SongMasterSource {
  return {
    async fetchMaster(songId: string) {
      const localPath = join(workDir, `${songId.replace(/[^A-Za-z0-9._-]+/g, '-') || 'song'}.mp3`);
      if (existsSync(audio)) {
        copyFileSync(audio, localPath); // already a local file
        return { localPath };
      }
      const res = await fetch(audio);
      if (!res.ok) return null; // treated as 404 by the use case
      writeFileSync(localPath, Buffer.from(await res.arrayBuffer()));
      return { localPath };
    },
  };
}

/** Dry-run storage: copies the instrumental to --out and returns the local
 *  path as the (stand-in) object key — no S3 write. */
function localStorage(outPath: string): KaraokeInstrumentalStorage {
  return {
    async store({ localPath }) {
      copyFileSync(localPath, outPath);
      return { objectKey: outPath };
    },
  };
}

const loggingRepository: KaraokeAssetRepository = {
  async save(asset) {
    console.log('[dry-run] would persist karaoke asset:', JSON.stringify(asset.toJSON(), null, 2));
  },
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workDir = mkdtempSync(join(tmpdir(), 'karaoke-src-'));

  const masters = masterSource(args.audio, workDir);
  const separator = new DemucsStemSeparator({ python: args.python, model: args.model });

  let storage: KaraokeInstrumentalStorage;
  let repository: KaraokeAssetRepository;
  if (args.publish) {
    storage = new S3KaraokeInstrumentalStorage();
    repository = new DynamoKaraokeAssetRepository();
    console.log('▶ PUBLISH mode: instrumental → gated S3, asset → DynamoDB');
  } else {
    const out = args.out ?? join(process.cwd(), `${args.song}-instrumental.mp3`);
    storage = localStorage(out);
    repository = loggingRepository;
    console.log(`▶ DRY RUN: instrumental → ${out} (no S3/DynamoDB writes). Pass --publish to go live.`);
  }

  const useCase = new GenerateKaraokeStem(masters, separator, storage, repository);
  console.log(`Separating vocals from "${args.song}" — this takes a few minutes on CPU…`);
  const result = await useCase.execute(args.song);

  if (result.ok) {
    console.log('✅ Karaoke instrumental ready.');
    console.log(JSON.stringify(result.asset.toJSON(), null, 2));
    process.exit(0);
  } else {
    console.error(`❌ Failed (${result.status}): ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
