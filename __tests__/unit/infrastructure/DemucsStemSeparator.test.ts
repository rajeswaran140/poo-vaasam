/**
 * DemucsStemSeparator — adapter tests.
 *
 * The subprocess runner and file-existence check are injected, so these verify
 * the command construction, stem-path resolution, transcode, and failure modes
 * with no torch/ffmpeg installed.
 */

import path from 'node:path';
import { DemucsStemSeparator, type CommandRunner } from '@/infrastructure/audio/DemucsStemSeparator';

const SOURCE = '/tmp/masters/sevvanthi.mp3'; // path.parse().name === "sevvanthi"

function makeSeparator(opts?: {
  run?: CommandRunner;
  fileExists?: (p: string) => boolean;
  model?: string;
}) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run: CommandRunner =
    opts?.run ??
    (async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      if (cmd === 'ffprobe') return { stdout: '214.6\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
  const fileExists = opts?.fileExists ?? (() => true);
  const separator = new DemucsStemSeparator({
    run,
    fileExists,
    model: opts?.model ?? 'htdemucs',
    python: 'python3',
  });
  return { separator, calls };
}

describe('DemucsStemSeparator', () => {
  it('runs demucs two-stem separation, transcodes, and reports duration', async () => {
    const { separator, calls } = makeSeparator();

    const out = await separator.separate({ songId: 'sevvanthi', sourceAudioPath: SOURCE });

    expect(out.model).toBe('htdemucs');
    expect(out.durationSeconds).toBe(215); // rounded from 214.6
    expect(path.basename(out.instrumentalPath)).toBe('sevvanthi-instrumental.mp3');

    const demucs = calls.find((c) => c.args.includes('demucs'));
    expect(demucs?.cmd).toBe('python3');
    expect(demucs?.args).toEqual(
      expect.arrayContaining(['-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', SOURCE])
    );

    const ffmpeg = calls.find((c) => c.cmd === 'ffmpeg');
    expect(ffmpeg?.args).toEqual(expect.arrayContaining(['-b:a', '192k', '-c:a', 'libmp3lame']));
    // ffmpeg reads the demucs "no_vocals" stem for this track.
    expect(ffmpeg?.args.some((a) => a.endsWith(path.join('htdemucs', 'sevvanthi', 'no_vocals.wav')))).toBe(true);
  });

  it('throws when the instrumental stem was not produced', async () => {
    const { separator } = makeSeparator({
      fileExists: (p) => !p.endsWith('no_vocals.wav'), // stem missing
    });
    await expect(separator.separate({ songId: 's', sourceAudioPath: SOURCE })).rejects.toThrow(/stem not found/i);
  });

  it('throws when the transcode produced no file', async () => {
    const { separator } = makeSeparator({
      fileExists: (p) => !p.endsWith('-instrumental.mp3'), // mp3 missing
    });
    await expect(separator.separate({ songId: 's', sourceAudioPath: SOURCE })).rejects.toThrow(/transcode produced no file/i);
  });

  it('still succeeds (duration undefined) when ffprobe fails', async () => {
    const run: CommandRunner = async (cmd: string) => {
      if (cmd === 'ffprobe') throw new Error('ffprobe boom');
      return { stdout: '', stderr: '' };
    };
    const { separator } = makeSeparator({ run });
    const out = await separator.separate({ songId: 's', sourceAudioPath: SOURCE });
    expect(out.durationSeconds).toBeUndefined();
    expect(out.instrumentalPath).toContain('-instrumental.mp3');
  });

  it('rejects an empty source path before spawning anything', async () => {
    const run = jest.fn();
    const separator = new DemucsStemSeparator({ run: run as unknown as CommandRunner, fileExists: () => true });
    await expect(separator.separate({ songId: 's', sourceAudioPath: '  ' })).rejects.toThrow(/required/i);
    expect(run).not.toHaveBeenCalled();
  });
});
