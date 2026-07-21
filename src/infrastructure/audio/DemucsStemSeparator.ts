/**
 * DemucsStemSeparator — infrastructure adapter implementing {@link
 * ../../application/ports/StemSeparator} with Meta's Demucs (MIT-licensed).
 *
 * It shells to `python -m demucs --two-stems=vocals`, which writes a
 * `no_vocals` stem (the instrumental) next to a `vocals` stem, then transcodes
 * that stem to a 192 kbps MP3 to match how songs are already served, and probes
 * its duration with ffprobe.
 *
 * The subprocess invocations are injected (`run`) and file existence is
 * injected (`fileExists`) so the arg construction and stem-resolution logic are
 * unit-testable without torch or ffmpeg present. Heavy ML runs offline (CLI /
 * batch), never in a request path.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type {
  StemSeparator,
  StemSeparationInput,
  StemSeparationOutput,
} from '@/application/ports/StemSeparator';

const execFileAsync = promisify(execFile);

/** Runs a command with an argv array (no shell — args are not interpolated). */
export type CommandRunner = (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface DemucsOptions {
  /** Demucs model name (also the reported `model`). Default "htdemucs". */
  model?: string;
  /** Python executable that has `demucs` importable. Default "python3". */
  python?: string;
  /** ffmpeg / ffprobe executables. Default "ffmpeg" / "ffprobe". */
  ffmpeg?: string;
  ffprobe?: string;
  /** Output bitrate for the instrumental MP3. Default "192k". */
  bitrate?: string;
  /** Parent dir for temp work. Default os.tmpdir(). */
  workDir?: string;
  /** Seam: subprocess runner. Default execFile (buffered). */
  run?: CommandRunner;
  /** Seam: does a produced file exist? Default fs.existsSync. */
  fileExists?: (p: string) => boolean;
}

const defaultRun: CommandRunner = (cmd, args) =>
  // 512 MB buffer: demucs is chatty and ffprobe/ffmpeg can log a lot.
  execFileAsync(cmd, args, { maxBuffer: 512 * 1024 * 1024 });

export class DemucsStemSeparator implements StemSeparator {
  readonly model: string;
  private readonly python: string;
  private readonly ffmpeg: string;
  private readonly ffprobe: string;
  private readonly bitrate: string;
  private readonly workDir: string;
  private readonly run: CommandRunner;
  private readonly fileExists: (p: string) => boolean;

  constructor(opts: DemucsOptions = {}) {
    this.model = opts.model ?? 'htdemucs';
    this.python = opts.python ?? 'python3';
    this.ffmpeg = opts.ffmpeg ?? 'ffmpeg';
    this.ffprobe = opts.ffprobe ?? 'ffprobe';
    this.bitrate = opts.bitrate ?? '192k';
    this.workDir = opts.workDir ?? tmpdir();
    this.run = opts.run ?? defaultRun;
    this.fileExists = opts.fileExists ?? existsSync;
  }

  async separate(input: StemSeparationInput): Promise<StemSeparationOutput> {
    const source = input.sourceAudioPath;
    if (!source?.trim()) {
      throw new Error('DemucsStemSeparator: sourceAudioPath is required');
    }

    const outDir = await mkdtemp(path.join(this.workDir, 'karaoke-'));

    // 1. Separate into two stems; vocals removed → "no_vocals" is the backing track.
    await this.run(this.python, [
      '-m', 'demucs',
      '--two-stems', 'vocals',
      '-n', this.model,
      '-o', outDir,
      source,
    ]);

    // Demucs writes: <outDir>/<model>/<track-name>/no_vocals.wav
    const trackName = path.parse(source).name;
    const noVocalsWav = path.join(outDir, this.model, trackName, 'no_vocals.wav');
    if (!this.fileExists(noVocalsWav)) {
      throw new Error(`DemucsStemSeparator: expected instrumental stem not found at ${noVocalsWav}`);
    }

    // 2. Transcode the stem to a 192 kbps MP3 (matches how songs are served).
    const instrumentalPath = path.join(outDir, `${trackName}-instrumental.mp3`);
    await this.run(this.ffmpeg, [
      '-y', '-i', noVocalsWav,
      '-c:a', 'libmp3lame', '-b:a', this.bitrate,
      instrumentalPath,
    ]);
    if (!this.fileExists(instrumentalPath)) {
      throw new Error(`DemucsStemSeparator: transcode produced no file at ${instrumentalPath}`);
    }

    // 3. Best-effort duration probe; absence must not fail the separation.
    const durationSeconds = await this.probeDuration(instrumentalPath);

    return { instrumentalPath, model: this.model, durationSeconds };
  }

  private async probeDuration(file: string): Promise<number | undefined> {
    try {
      const { stdout } = await this.run(this.ffprobe, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        file,
      ]);
      const seconds = Number.parseFloat(stdout.trim());
      return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : undefined;
    } catch {
      return undefined;
    }
  }
}
