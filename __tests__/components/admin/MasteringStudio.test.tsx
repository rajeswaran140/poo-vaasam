/** @jest-environment jsdom */
/**
 * MasteringStudio — the Sound Engineering page. Covers the paths an audit found
 * broken on first ship: dual-target re-master without re-upload, the verdict
 * copy matrix (including a null check-measurement), download behaviour, and
 * re-attaching to a job left running by a previous mount.
 *
 * adminFetch and the S3 XHR upload are mocked; no network, no real files.
 */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('lucide-react', () => ({
  SlidersHorizontal: () => <svg data-testid="i-sliders" />,
  Upload: () => <svg data-testid="i-upload" />,
  Download: () => <svg data-testid="i-download" />,
  Loader2: () => <svg data-testid="i-loader" />,
  CheckCircle2: () => <svg data-testid="i-check" />,
  AlertTriangle: () => <svg data-testid="i-alert" />,
  FileAudio: () => <svg data-testid="i-file" />,
  RotateCcw: () => <svg data-testid="i-reset" />,
  X: () => <svg data-testid="i-x" />,
  Info: () => <svg data-testid="i-info" />,
  Save: () => <svg data-testid="i-save" />,
  Library: () => <svg data-testid="i-library" />,
  Scissors: () => <svg data-testid="i-scissors" />,
  Link2: () => <svg data-testid="i-link" />,
  Film: () => <svg data-testid="i-film" />,
  // Library ROWS use these three; no earlier test rendered a non-empty list.
  Play: () => <svg data-testid="i-play" />,
  Pause: () => <svg data-testid="i-pause" />,
  Pencil: () => <svg data-testid="i-pencil" />,
}));
// The before/after player is its own unit (see MasteringComparePlayer.test);
// stub it here so the Studio suite tests wiring, not the player's Web Audio /
// icon internals. Exposes a marker asserting it renders once a job is done.
jest.mock('@/components/admin/MasteringComparePlayer', () => ({
  MasteringComparePlayer: (p: { sourceKey: string; masterKey: string }) => (
    <div data-testid="compare-player" data-source={p.sourceKey} data-master={p.masterKey} />
  ),
}));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MasteringStudio, buildJoinPayload } from '@/components/admin/MasteringStudio';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as unknown as Response;

/** A completed job as the status route returns it (flattened). */
const doneJob = (over: Record<string, unknown> = {}) => ({
  id: 'job-1', status: 'done', s3Key: 'audio/mastering/1_a_song.wav',
  masterKey: 'audio/mastering/1_a_song-master-14LUFS.wav',
  target: -14, beforeLufs: -17.9, beforeTp: -3.6, afterLufs: -14, afterTp: -1.2,
  error: null, ...over,
});

/** Drive: presign -> (XHR upload) -> enqueue -> status(done). */
function primeHappyPath(job: Record<string, unknown> = doneJob()) {
  mockedFetch
    .mockResolvedValueOnce(json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_a_song.wav' }))
    .mockResolvedValueOnce(json({ success: true, jobId: 'job-1', status: 'queued' }))
    .mockResolvedValue(json(job));
}

const wavFile = (name = 'song.wav', size = 1024) => {
  const f = new File(['x'], name, { type: 'audio/wav' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

async function uploadA(file = wavFile()) {
  const input = document.getElementById(
    screen.getByText(/Drop a WAV here/i).closest('label')!.getAttribute('for')!
  ) as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

// Minimal XMLHttpRequest that reports success immediately.
class FakeXHR {
  status = 204;
  responseText = '';
  upload = { onprogress: null as null | ((e: unknown) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  open() {}
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 512, total: 1024 });
    this.onload?.();
  }
  abort() { this.onabort?.(); }
}

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks does NOT drain queued mockResolvedValueOnce values; without a
  // reset an unconsumed response leaks into the next test and mis-answers the
  // first call it makes.
  mockedFetch.mockReset();
  sessionStorage.clear();
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
  window.open = jest.fn();
});

describe('source selection', () => {
  it('rejects a non-WAV with an explanation and never calls the API', async () => {
    render(<MasteringStudio />);
    await uploadA(new File(['x'], 'song.mp3', { type: 'audio/mpeg' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a WAV/i);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized file before uploading', async () => {
    render(<MasteringStudio />);
    await uploadA(wavFile('big.wav', 600 * 1024 * 1024));
    expect(await screen.findByRole('alert')).toHaveTextContent(/over the/i);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('uploads a WAV and arms the Master button', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    expect(mockedFetch.mock.calls[0][0]).toBe('/api/admin/mastering/upload');
  });
});

describe('verdict copy', () => {
  const runTo = async (job: Record<string, unknown>) => {
    primeHappyPath(job);
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);
  };

  it('passes a master that lands within 1 LU — not the 0.1 LU hair-trigger', async () => {
    // Two-pass loudnorm routinely lands a few tenths off; that is a good master.
    await runTo(doneJob({ afterLufs: -14.3 }));
    expect(screen.getByText(/Landed on -14 LUFS, peak-safe/)).toBeInTheDocument();
    expect(screen.queryByText(/worth a listen/i)).not.toBeInTheDocument();
  });

  it('flags a genuinely off-target master', async () => {
    await runTo(doneJob({ afterLufs: -19, beforeLufs: -19.5 }));
    expect(screen.getByText(/worth a listen before you use it/i)).toBeInTheDocument();
    // The reassuring "already on target" line must NOT also appear.
    expect(screen.queryByText(/correct outcome for a song that was already on target/i)).not.toBeInTheDocument();
  });

  it('reassures only when on-target AND the move was inaudible', async () => {
    await runTo(doneJob({ beforeLufs: -14.4, afterLufs: -14 }));
    expect(screen.getByText(/below what anyone can hear/i)).toBeInTheDocument();
  });

  it('handles a null check-measurement as its own state, not a failure', async () => {
    // The worker's pass-3 parse can fail on a master that is otherwise fine.
    await runTo(doneJob({ afterLufs: null, afterTp: null }));
    expect(screen.getByText(/check measurement did not come back/i)).toBeInTheDocument();
    expect(screen.queryByText(/Measured — against/)).not.toBeInTheDocument();
  });
});

describe('dual-target workflow', () => {
  it('re-arms Master after a run so the second target needs no re-upload', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    // Pick Apple's -16: the button must become live again, still holding the
    // uploaded source. Previously it stayed disabled and the only way on was a
    // full re-upload.
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /-16 LUFS/ })); });
    const master16 = screen.getByRole('button', { name: /Master to -16/ });
    expect(master16).toBeEnabled();
    // The stale -14 result must not still be on screen against the new target.
    expect(screen.queryByText(/3 · Result/)).not.toBeInTheDocument();
  });

  it('keeps the trim/fade when mastering the SAME source to a second target', async () => {
    // The dual-target flow above re-arms without a re-upload, so the edit the
    // admin set for -14 must still be attached for -16. If the trim panel is
    // torn down while the worker runs, it remounts empty and silently clears
    // the edit — the second master would then be the untrimmed file, with
    // nothing on screen saying so.
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Fade out/i), { target: { value: '6' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /-16 LUFS/ })); });
    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-2', status: 'queued' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -16/ })); });

    const enqueues = mockedFetch.mock.calls.filter(
      ([url]) => String(url) === '/api/admin/music-lab/master'
    );
    expect(enqueues).toHaveLength(2);
    const second = JSON.parse(String((enqueues[1][1] as RequestInit).body));
    expect(second.target).toBe(-16);
    expect(second.edit?.fadeOutSec).toBe(6);
  });

  it('sends a trim typed into the time boxes, with no waveform involved', async () => {
    // jsdom has no AudioContext, so the panel never draws — which is exactly
    // the degraded path the copy promises works. The numbers are the real
    // input; the picture is an aid.
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Keep from/i), { target: { value: '2.5' } });
      fireEvent.change(screen.getByLabelText(/Keep until/i), { target: { value: '184' } });
      fireEvent.change(screen.getByLabelText(/Fade out/i), { target: { value: '6' } });
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });

    const enqueue = mockedFetch.mock.calls.find(
      ([url]) => String(url) === '/api/admin/music-lab/master'
    )!;
    const sent = JSON.parse(String((enqueue[1] as RequestInit).body));
    expect(sent.edit).toEqual({
      trimStartSec: 2.5, trimEndSec: 184, fadeInSec: 0, fadeOutSec: 6, curve: 'qsin',
    });
  });

  it('omits `edit` entirely when nothing was trimmed or faded', async () => {
    // The backward-compatibility promise: an untouched panel must produce the
    // exact request body the route always received.
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });

    const enqueue = mockedFetch.mock.calls.find(
      ([url]) => String(url) === '/api/admin/music-lab/master'
    )!;
    expect(JSON.parse(String((enqueue[1] as RequestInit).body))).toEqual({
      s3Key: 'audio/mastering/1_a_song.wav', target: -14,
    });
  });

  it('exposes the targets as a radio group', async () => {
    render(<MasteringStudio />);
    expect(screen.getByRole('radiogroup', { name: /target/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /-14 LUFS/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /-16 LUFS/ })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('download', () => {
  it('opens a new tab rather than navigating the page away', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);

    mockedFetch.mockResolvedValueOnce(json({ success: true, url: 'https://s3/signed', filename: 'song-master-14LUFS.wav' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Download for Adobe/ })); });

    // Navigating would destroy the result panel; a new tab preserves it.
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://s3/signed', '_blank', 'noopener'));
    expect(screen.getByText(/3 · Result/)).toBeInTheDocument();
  });

  it('carries the master title (with its target) into the download request', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/name this master/i), { target: { value: 'Amma En Agame' } });
    });
    mockedFetch.mockResolvedValueOnce(json({ success: true, url: 'https://s3/signed', filename: 'x.wav' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Download for Adobe/ })); });

    const url = mockedFetch.mock.calls.at(-1)![0] as string;
    expect(url).toContain('name=' + encodeURIComponent('Amma En Agame (Master -14 LUFS)'));
  });

  it('with no title, the download request omits the name (server de-noises the key)', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);

    mockedFetch.mockResolvedValueOnce(json({ success: true, url: 'https://s3/signed', filename: 'x.wav' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Download for Adobe/ })); });
    expect(mockedFetch.mock.calls.at(-1)![0] as string).not.toContain('name=');
  });

  it('saves a loudness report as a downloadable text file', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);

    const createObjectURL = jest.fn(() => 'blob:report');
    const revokeObjectURL = jest.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL;
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Download report/ })); });

    // A Blob was turned into an object URL and a click fired to save it; the
    // report's content/name are pinned in master-report.test.ts.
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    clickSpy.mockRestore();
  });

  it('shows how the master lands on each streaming platform', async () => {
    primeHappyPath(); // doneJob masters to −14
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);

    expect(screen.getByText(/Streaming readiness/i)).toBeInTheDocument();
    // −14 master plays as-is on the −14 streamers, playback lowered on Apple −16.
    expect(screen.getByText(/plays exactly as mastered/i)).toBeInTheDocument();
    expect(screen.getByText(/playback normalised ~2\.0 LU · original audio unchanged/)).toBeInTheDocument();
  });
});

describe('cancelling is an outcome, not a failure', () => {
  /** An upload that stays in flight until the component aborts it. */
  class PendingXHR {
    status = 0;
    responseText = '';
    upload = { onprogress: null as null | ((e: unknown) => void) };
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    onabort: null | (() => void) = null;
    open() {}
    send() {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 256, total: 1024 });
    }
    abort() { this.onabort?.(); }
  }

  it('"Cancel upload" does not render an error alert', async () => {
    // Regression: the XHR's own abort rejected with "Upload cancelled.", hit the
    // shared catch and painted a red role="alert" — telling the admin something
    // had broken when they had simply changed their mind.
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = PendingXHR;
    mockedFetch.mockResolvedValueOnce(
      json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_a_song.wav' })
    );

    render(<MasteringStudio />);
    await uploadA();
    const cancel = await screen.findByRole('button', { name: /Cancel upload/i });
    await act(async () => { fireEvent.click(cancel); });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // …and it is genuinely back at the start, ready for another file.
    expect(screen.getByText(/Drop a WAV here/i)).toBeInTheDocument();
  });

  it('"Stop watching" does not report the running job as failed', async () => {
    // Regression: aborting while a poll was in flight rejected the fetch with an
    // AbortError, which the catch rendered as "Mastering failed." plus a raw
    // "signal is aborted without reason" — for a job still running fine.
    mockedFetch
      .mockResolvedValueOnce(json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_a_song.wav' }))
      .mockResolvedValueOnce(json({ success: true, jobId: 'job-7', status: 'queued' }))
      // A status call that behaves like a real aborted fetch: pending until the
      // caller's signal fires, then rejecting with an AbortError.
      .mockImplementation((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('signal is aborted without reason', 'AbortError'))
          );
        })
      );

    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });

    const stop = await screen.findByRole('button', { name: /Stop watching/i });
    await act(async () => { fireEvent.click(stop); });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Mastering failed/i)).not.toBeInTheDocument();
    // The job is still ours to come back to.
    expect(screen.getByRole('button', { name: /Resume watching job/i })).toBeInTheDocument();
    expect(sessionStorage.getItem('mastering-studio-job')).toContain('job-7');
  });

  it('resumes a stopped watch without a page reload', async () => {
    mockedFetch
      .mockResolvedValueOnce(json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_a_song.wav' }))
      .mockResolvedValueOnce(json({ success: true, jobId: 'job-7', status: 'queued' }))
      .mockImplementationOnce((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
      );

    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Stop watching/i })); });

    // The job finished while we weren't looking; resuming must pick it up.
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-7' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Resume watching job/i })); });

    await screen.findByText(/3 · Result/);
    expect(mockedFetch.mock.calls.at(-1)![0]).toBe('/api/admin/music-lab/master/job-7');
  });
});

describe('source file info', () => {
  it('shows what the source actually was next to its measurements', async () => {
    primeHappyPath(
      doneJob({
        source: { codec: 'pcm_s16le', sampleRate: 44100, channels: 2, channelLayout: 'stereo', bitDepth: 16, durationSec: 222.1 },
      })
    );
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);

    expect(screen.getByText('16-bit · 44.1 kHz · stereo · 3:42')).toBeInTheDocument();
    expect(screen.getByText('24-bit · 48 kHz')).toBeInTheDocument(); // what we wrote
  });

  it('renders the result table unchanged for a job with no source info', async () => {
    // Jobs enqueued before the worker captured it carry source: null.
    primeHappyPath(doneJob({ source: null }));
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to/ })); });
    await screen.findByText(/3 · Result/);
    expect(screen.getByRole('rowheader', { name: /^Source$/ })).toBeInTheDocument();
  });
});

describe('job recovery', () => {
  it('re-attaches to a job left running by a previous mount', async () => {
    // The worker keeps going whether or not this component is mounted.
    sessionStorage.setItem(
      'mastering-studio-job',
      JSON.stringify({ jobId: 'job-9', sourceKey: 'audio/mastering/1_a_song.wav', name: 'song.wav', size: 1024, target: -14 })
    );
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-9' })));

    render(<MasteringStudio />);

    await screen.findByText(/3 · Result/);
    expect(screen.getByText('song.wav')).toBeInTheDocument();
    expect(mockedFetch.mock.calls[0][0]).toBe('/api/admin/music-lab/master/job-9');
    // A finished job must not be replayed on the next mount.
    await waitFor(() => expect(sessionStorage.getItem('mastering-studio-job')).toBeNull());
  });
});

/**
 * Save/publish state belongs to the JOB, not the visit.
 *
 * Found auditing the page on 2026-08-04. `savedAt` was set on the first save
 * and never cleared, so mastering a second file in the same session met a
 * disabled "Saved to library" button belonging to the previous master — the new
 * one could not be saved without reloading the page. Publishing would have
 * inherited exactly the same bug.
 */
describe('per-job state resets between masters', () => {
  it('re-enables Save for a second master in the same session', async () => {
    primeHappyPath(doneJob({ mp3Key: 'audio/mastering/1_a_song-master-14LUFS.mp3', mp3Tp: -3.5 }));
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    // Save the first master.
    mockedFetch.mockResolvedValueOnce(json({ success: true, title: 'One' }));
    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save to library/ })); });
    await screen.findByRole('button', { name: /Saved to library/ });

    // Master the same source to the other target — a fresh job.
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /-16 LUFS/ })); });
    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-2', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-2', target: -16, afterLufs: -16 })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -16/ })); });
    await screen.findByText(/3 · Result/);

    // The second master must be savable. Before the fix this read "Saved to
    // library" and was disabled, for a job that had never been saved.
    const save = await screen.findByRole('button', { name: /Save to library/ });
    expect(save).toBeEnabled();
  });

  it('does not offer Publish until the master has been saved', async () => {
    // The title is the published filename, and save is what persists it.
    primeHappyPath(doneJob({ mp3Key: 'audio/mastering/1_a_song-master-14LUFS.mp3', mp3Tp: -3.5 }));
    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    expect(screen.queryByRole('button', { name: /Publish web MP3/ })).not.toBeInTheDocument();
  });
});

/**
 * Two-part assembly wiring.
 *
 * The domain rules live in master-join.test.ts and the render in the worker
 * suite. What only this layer can prove is that the panel's numbers actually
 * reach the enqueue call — a seam the admin set but the request never carried
 * would master Part A alone and look entirely successful.
 */
describe('two-part assembly', () => {
  /**
   * One presign response, queued immediately before the upload that consumes it.
   * primeHappyPath queues presign AND enqueue up front, so an extra upload in
   * between would eat the enqueue response — the queue is order-sensitive, and
   * these tests upload twice.
   */
  const primePresign = (key: string) =>
    mockedFetch.mockResolvedValueOnce(
      json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key })
    );

  /** Upload Part B through the join panel, mirroring uploadA. */
  async function uploadB(name = 'part-b.wav') {
    const input = document.getElementById(
      screen.getByText(/Add Part B/i).closest('label')!.getAttribute('for')!
    ) as HTMLInputElement;
    const f = new File(['x'], name, { type: 'audio/wav' });
    Object.defineProperty(f, 'size', { value: 2048 });
    primePresign('audio/mastering/1_b_partb.wav');
    await act(async () => { fireEvent.change(input, { target: { files: [f] } }); });
  }

  it('carries the seam into the enqueue request', async () => {
    primePresign('audio/mastering/1_a_song.wav');
    render(<MasteringStudio />);
    await uploadA();
    await uploadB();

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Crossfade \(seconds\)/i), { target: { value: '4.5' } });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Part B starts at/i), { target: { value: '2' } });
    });

    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-1', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob()));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    const enqueue = mockedFetch.mock.calls.find(
      (c) => c[0] === '/api/admin/music-lab/master' && c[1]?.method === 'POST'
    )!;
    const body = JSON.parse(enqueue[1].body);
    expect(body.join).toMatchObject({
      partBKey: 'audio/mastering/1_b_partb.wav',
      overlapSec: 4.5,
      // Equal power, always — a linear crossfade dips 3 dB mid-seam.
      curve: 'qsin',
    });
    // The head trim is how Part B's entry lands on the beat.
    expect(body.join.editB).toMatchObject({ trimStartSec: 2 });
  });

  it('omits `join` entirely when no Part B was added', async () => {
    // The single-source path must send exactly the body it always did.
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    const enqueue = mockedFetch.mock.calls.find(
      (c) => c[0] === '/api/admin/music-lab/master' && c[1]?.method === 'POST'
    )!;
    expect(JSON.parse(enqueue[1].body)).not.toHaveProperty('join');
  });

  it('claims no Part B edit when it is used from its start', async () => {
    primePresign('audio/mastering/1_a_song.wav');
    render(<MasteringStudio />);
    await uploadA();
    await uploadB();

    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-1', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob()));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    const enqueue = mockedFetch.mock.calls.find(
      (c) => c[0] === '/api/admin/music-lab/master' && c[1]?.method === 'POST'
    )!;
    // Explicitly null rather than absent — parseMasterJoin treats the two the
    // same, and null matches the MasterJoin type the payload builder returns.
    expect(JSON.parse(enqueue[1].body).join.editB).toBeNull();
  });

  it('refuses an MP3 as Part B, naming the reason', async () => {
    // Encoder padding adds silent frames at the head and tail that misalign the
    // overlap — worse here than for a single-source master.
    primePresign('audio/mastering/1_a_song.wav');
    render(<MasteringStudio />);
    await uploadA();
    const input = document.getElementById(
      screen.getByText(/Add Part B/i).closest('label')!.getAttribute('for')!
    ) as HTMLInputElement;
    const mp3 = new File(['x'], 'part-b.mp3', { type: 'audio/mpeg' });
    await act(async () => { fireEvent.change(input, { target: { files: [mp3] } }); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/Part B must be a WAV/i);
  });
});

/**
 * Audit fixes on the two-part assembly (2026-08-04, before merge).
 *
 * All three are the same species: a join that is silently WRONG rather than
 * visibly broken. A stale Part B masters cleanly, a dropped Part B masters
 * cleanly, and neither says anything on screen — you get a different song and a
 * green tick.
 */
describe('two-part assembly — stale and lost state', () => {
  const primePresign2 = (key: string) =>
    mockedFetch.mockResolvedValueOnce(
      json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key })
    );

  async function addPartB() {
    const input = document.getElementById(
      screen.getByText(/Add Part B/i).closest('label')!.getAttribute('for')!
    ) as HTMLInputElement;
    const f = new File(['x'], 'part-b.wav', { type: 'audio/wav' });
    Object.defineProperty(f, 'size', { value: 2048 });
    primePresign2('audio/mastering/1_b_partb.wav');
    await act(async () => { fireEvent.change(input, { target: { files: [f] } }); });
  }

  it('drops Part B on Start over, so the next song cannot inherit it', async () => {
    // A Part B surviving into the next song would crossfade an unrelated section
    // onto it and master perfectly cleanly — wrong audio, green tick.
    //
    // Named for the OUTCOME, not a mechanism, because two clears cover this
    // path (reset() and onPick) and mutation-testing shows neither is solely
    // load-bearing: removing either alone still passes, removing both fails.
    // Asserting one of them specifically would be a test that cannot fail for
    // the reason its name gives. Same call as the parseSourceInfo region cut in
    // the worker suite.
    primePresign2('audio/mastering/1_a_song.wav');
    render(<MasteringStudio />);
    await uploadA();
    await addPartB();
    expect(screen.getByLabelText(/Crossfade \(seconds\)/i)).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start over/i })); });
    primePresign2('audio/mastering/2_c_other.wav');
    await uploadA(wavFile('another-song.wav'));

    expect(screen.queryByLabelText(/Crossfade \(seconds\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Add Part B/i)).toBeInTheDocument();
  });

  it('restores the join after a remount, so a reload cannot quietly drop a section', async () => {
    // Without this the panel comes back collapsed and re-mastering to the second
    // target produces Part A alone — a shorter song, with nothing saying so.
    sessionStorage.setItem(
      'mastering-studio-job',
      JSON.stringify({
        jobId: 'job-1', sourceKey: 'audio/mastering/1_a_song.wav',
        name: 'song.wav', size: 1024, target: -14,
        partBKey: 'audio/mastering/1_b_partb.wav', partBName: 'part-b.wav',
        overlapSec: 4.5, partBStartSec: 2,
      })
    );
    mockedFetch.mockResolvedValue(json(doneJob()));
    render(<MasteringStudio />);

    await screen.findByText(/3 · Result/);
    // Re-arm for the second target: the join must still be attached.
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: /-16 LUFS/ })); });
    expect(await screen.findByText('part-b.wav')).toBeInTheDocument();
    expect((screen.getByLabelText(/Crossfade \(seconds\)/i) as HTMLInputElement).value).toBe('4.5');
    expect((screen.getByLabelText(/Part B starts at/i) as HTMLInputElement).value).toBe('2');
  });

  it('states the assembly in the result panel', async () => {
    // A master that is 6:20 when the take was 3:40 is otherwise unexplained.
    primeHappyPath(doneJob({
      join: { partBKey: 'audio/mastering/1_b_partb.wav', overlapSec: 3, curve: 'qsin', editB: null },
      editedDurationSec: 380,
    }));
    render(<MasteringStudio />);
    await uploadA();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    expect(screen.getByText(/Two parts joined with a 3s crossfade \(qsin, equal power\) — 6:20 assembled/)).toBeInTheDocument();
  });
});


/**
 * The YouTube render, from the page's side.
 *
 * The domain rules are in master-video.test.ts and the encode in the worker
 * suite. Only this layer can show that the panel appears when it should, that a
 * cover reaches the request, and that the finished MP4 becomes reachable —
 * a render that succeeded server-side but never surfaced a download would be
 * indistinguishable from one that never ran.
 */
describe('render for YouTube', () => {
  const savedDoneJob = (over: Record<string, unknown> = {}) =>
    doneJob({ mp3Key: 'audio/mastering/1_a_song-master-14LUFS.mp3', mp3Tp: -3.5, ...over });

  /** Master, then save — the render panel only exists past that point. */
  async function masterAndSave(job: Record<string, unknown> = savedDoneJob()) {
    primeHappyPath(job);
    render(<MasteringStudio />);
    await uploadA();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);
    mockedFetch.mockResolvedValueOnce(json({ success: true, title: 'One' }));
    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save to library/ })); });
    await screen.findByRole('button', { name: /Saved to library/ });
  }

  async function addCover() {
    const input = screen.getByLabelText(/Cover image/i) as HTMLInputElement;
    const f = new File(['x'], 'cover.jpg', { type: 'image/jpeg' });
    mockedFetch.mockResolvedValueOnce(
      json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
    );
    await act(async () => { fireEvent.change(input, { target: { files: [f] } }); });
  }

  it('does not offer a render until the master is saved', async () => {
    // The title becomes the download name, and an unsaved job expires in 24h.
    primeHappyPath(savedDoneJob());
    render(<MasteringStudio />);
    await uploadA();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);
    expect(screen.queryByRole('button', { name: /Render video/ })).not.toBeInTheDocument();
  });

  it('uploads the cover as a cover, not as audio', async () => {
    // The upload route's WAV-only guard would reject an image sent as audio.
    await masterAndSave();
    await addCover();

    const upload = mockedFetch.mock.calls
      .filter((c) => c[0] === '/api/admin/mastering/upload')
      .map((c) => JSON.parse(c[1].body))
      .pop();
    expect(upload).toMatchObject({ kind: 'cover', contentType: 'image/jpeg' });
  });

  it('needs a cover before it will render', async () => {
    await masterAndSave();
    expect(screen.getByRole('button', { name: /Render video/ })).toBeDisabled();
    await addCover();
    expect(screen.getByRole('button', { name: /Render video/ })).toBeEnabled();
  });

  it('sends the cover and the chosen height, then surfaces the MP4', async () => {
    // No fake timers: the poll checks once immediately, so a render that is
    // already finished resolves without any clock manipulation. Timing-sensitive
    // tests are the classic thing that passes here and fails on a CI runner.
    await masterAndSave();
    await addCover();
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Upload size/i), { target: { value: '2160' } });
    });

    mockedFetch.mockResolvedValueOnce(json({ success: true, videoKey: 'v', height: 2160, status: 'queued' }));
    mockedFetch.mockResolvedValue(
      json(savedDoneJob({ videoKey: 'audio/mastering/1_a_song-master-14LUFS-2160p.mp4' }))
    );
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Render video/ })); });

    const req = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/render'))!;
    expect(JSON.parse(req[1].body)).toEqual({ coverKey: 'audio/mastering/1_c_cover.jpg', height: 2160 });
    expect(await screen.findByRole('button', { name: /Download MP4/ })).toBeInTheDocument();
  });

  it('reports a render failure instead of spinning forever', async () => {
    await masterAndSave();
    await addCover();
    mockedFetch.mockResolvedValueOnce(json({ success: true, videoKey: 'v', height: 1440, status: 'queued' }));
    mockedFetch.mockResolvedValue(json(savedDoneJob({ videoError: 'x264 died' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Render video/ })); });

    expect(await screen.findByRole('alert')).toHaveTextContent(/x264 died/);
    expect(screen.getByRole('button', { name: /Render video/ })).toBeEnabled();
  });
});

/**
 * Edit & re-master from the library.
 *
 * The module's whole ordering rests on an edit being a RECIPE over an untouched
 * source, which means a saved job already carries everything needed to run
 * again. Before this, coming back the next day to change a fade by half a second
 * meant re-uploading the WAV.
 *
 * The property under test is the ROUND TRIP: what was saved is what comes back
 * and what gets sent. A recipe that silently loses its trim would re-master the
 * whole file, produce a longer song, and look completely successful.
 */
describe('re-opening a saved master', () => {
  const EDIT = { trimStartSec: 12, trimEndSec: 200, fadeInSec: 0, fadeOutSec: 6, curve: 'qsin' as const };
  const saved = (over: Record<string, unknown> = {}) => ({
    id: 'saved-1',
    status: 'done',
    s3Key: 'audio/mastering/1700000000000_ab12_kadhal.wav',
    masterKey: 'audio/mastering/1700000000000_ab12_kadhal-master-16LUFS.wav',
    target: -16,
    title: 'காதல் மழை',
    savedAt: '2026-08-01T10:00:00.000Z',
    edit: EDIT,
    join: null,
    source: { codec: 'pcm_s24le', sampleRate: 48000, channels: 2, channelLayout: 'stereo', bitDepth: 24, durationSec: 365 },
    afterLufs: -16, afterTp: -3.2, beforeLra: 3, afterLra: 3,
    error: null,
    ...over,
  });

  /** Open the library and click through to re-master the first row. */
  async function reopen(job: Record<string, unknown> = saved()) {
    render(<MasteringStudio />);
    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [job] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saved masters/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Edit & re-master/i })); });
  }

  it('restores the source and the trim recipe without a re-upload', async () => {
    await reopen();

    // Back at the "ready" stage, armed against the SAME source — no dropzone.
    expect(screen.getByRole('button', { name: /Master to -16/ })).toBeEnabled();
    expect(screen.queryByText(/Drop a WAV here/i)).not.toBeInTheDocument();
    // The stored trim is in the boxes, not defaults.
    expect((screen.getByLabelText(/Keep from/i) as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText(/Fade out/i) as HTMLInputElement).value).toBe('6');
  });

  it('sends the SAME source key and the restored recipe when re-mastered', async () => {
    await reopen();
    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-9', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-9', target: -16, afterLufs: -16 })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -16/ })); });
    await screen.findByText(/3 · Result/);

    const enqueue = mockedFetch.mock.calls.find(
      (c) => c[0] === '/api/admin/music-lab/master' && c[1]?.method === 'POST'
    )!;
    const body = JSON.parse(enqueue[1].body);
    expect(body.s3Key).toBe('audio/mastering/1700000000000_ab12_kadhal.wav');
    expect(body.target).toBe(-16);
    expect(body.edit).toMatchObject({ trimStartSec: 12, trimEndSec: 200, fadeOutSec: 6, curve: 'qsin' });
  });

  it('does not re-send a tail trim that is just the end of the file', async () => {
    // What the job's recorded duration is actually FOR. A saved edit ending at
    // 365s on a 365s source is "runs to the end", not a trim; re-sending it as
    // an explicit end marks the job as edited and buys a pre-pass that copies
    // the file for nothing. Mutation-verified: with the duration withheld the
    // redundant end is sent.
    await reopen(saved({ edit: { ...EDIT, trimEndSec: 365 } }));
    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-9', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-9', target: -16, afterLufs: -16 })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -16/ })); });
    await screen.findByText(/3 · Result/);

    const enqueue = mockedFetch.mock.calls.find(
      (c) => c[0] === '/api/admin/music-lab/master' && c[1]?.method === 'POST'
    )!;
    expect(JSON.parse(enqueue[1].body).edit.trimEndSec).toBeNull();
  });

  it('restores a two-part seam as well as a trim', async () => {
    await reopen(saved({
      join: { partBKey: 'audio/mastering/1700000000001_cd34_partb.wav', overlapSec: 4.5, curve: 'qsin', editB: { trimStartSec: 2, trimEndSec: null, fadeInSec: 0, fadeOutSec: 0, curve: 'qsin' } },
    }));

    expect((screen.getByLabelText(/Crossfade \(seconds\)/i) as HTMLInputElement).value).toBe('4.5');
    expect((screen.getByLabelText(/Part B starts at/i) as HTMLInputElement).value).toBe('2');
  });

  it('carries the title across, so the download name survives', async () => {
    // The name field lives in the RESULT panel, so the restored title has to
    // survive the re-master to be worth anything — checking it at the "ready"
    // stage would assert against an input that is not on screen yet.
    await reopen();
    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-9', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-9', target: -16, afterLufs: -16 })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -16/ })); });
    await screen.findByText(/3 · Result/);

    expect((screen.getByLabelText(/Name this master/i) as HTMLInputElement).value).toBe('காதல் மழை');
  });

  it('does NOT present the re-opened job as already saved or published', async () => {
    // A re-open is a new run. Offering "Saved to library" or a publish against
    // it would act on a file this run has not produced.
    await reopen();
    expect(screen.queryByRole('button', { name: /Saved to library/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish web MP3/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/3 · Result/)).not.toBeInTheDocument();
  });

  it('clears a previous seam when re-opening a single-source master', async () => {
    // Leaking the last recipe's Part B into an unrelated song is the same
    // silent-wrong-audio failure the stale-Part-B fix addressed.
    render(<MasteringStudio />);
    mockedFetch.mockResolvedValueOnce(json({
      success: true,
      masters: [
        saved({ id: 'with-join', title: 'Joined', join: { partBKey: 'audio/mastering/x_partb.wav', overlapSec: 3, curve: 'qsin', editB: null } }),
        saved({ id: 'plain', title: 'Plain', join: null }),
      ],
    }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saved masters/i })); });
    const buttons = await screen.findAllByRole('button', { name: /Edit & re-master/i });

    await act(async () => { fireEvent.click(buttons[0]); });
    expect(screen.getByLabelText(/Crossfade \(seconds\)/i)).toBeInTheDocument();

    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saved masters/i })); });
    const again = await screen.findAllByRole('button', { name: /Edit & re-master/i });
    await act(async () => { fireEvent.click(again[1]); });

    expect(screen.queryByLabelText(/Crossfade \(seconds\)/i)).not.toBeInTheDocument();
  });
});

/**
 * Audit follow-ups on re-open (2026-08-05, before merge).
 *
 * "Restores the recipe" was only nearly true. The panel shows two of the seam's
 * fields, and rebuilding the seam from those two silently dropped everything
 * else — a non-default crossfade curve, and any tail trim or fade on Part B.
 * Neither is reachable through today's UI, but both are accepted by the API and
 * both CHANGE THE AUDIO, so a re-master would have produced a different song
 * while reporting complete success.
 */
describe('buildJoinPayload — the seam survives what the panel cannot show', () => {
  const seed = {
    partBKey: 'audio/mastering/b.wav',
    overlapSec: 3,
    curve: 'tri' as const,
    editB: { trimStartSec: 5, trimEndSec: 180, fadeInSec: 0, fadeOutSec: 2, curve: 'esin' as const },
  };

  it('keeps a non-default curve rather than resetting it to the default', () => {
    const out = buildJoinPayload({ partBKey: 'audio/mastering/b.wav', overlapSec: 4, partBStartSec: 5, seed });
    expect(out.curve).toBe('tri');
    expect(out.overlapSec).toBe(4); // the panel still owns the overlap
  });

  it('keeps Part B\'s tail trim and fades, which the panel has no field for', () => {
    const out = buildJoinPayload({ partBKey: 'audio/mastering/b.wav', overlapSec: 3, partBStartSec: 5, seed });
    expect(out.editB).toMatchObject({ trimEndSec: 180, fadeOutSec: 2, curve: 'esin' });
  });

  it('lets the panel win on the head trim, including clearing it to zero', () => {
    // Setting the box back to 0 is a real instruction, not an absent value.
    const out = buildJoinPayload({ partBKey: 'audio/mastering/b.wav', overlapSec: 3, partBStartSec: 0, seed });
    expect(out.editB?.trimStartSec).toBe(0);
    expect(out.editB?.trimEndSec).toBe(180);
  });

  it('sends no editB at all for a plain new seam', () => {
    const out = buildJoinPayload({ partBKey: 'audio/mastering/b.wav', overlapSec: 3, partBStartSec: 0, seed: null });
    expect(out).toEqual({ partBKey: 'audio/mastering/b.wav', overlapSec: 3, curve: 'qsin', editB: null });
  });

  it('defaults the curve to equal power when there is nothing to inherit', () => {
    expect(buildJoinPayload({ partBKey: 'b', overlapSec: 3, partBStartSec: 2, seed: null }).curve).toBe('qsin');
  });
});

describe('re-open: the seam seed is scoped to its own Part B', () => {
  const SEAM = {
    partBKey: 'audio/mastering/1700000000001_cd34_partb.wav',
    overlapSec: 4.5,
    curve: 'tri' as const,
    editB: { trimStartSec: 2, trimEndSec: 150, fadeInSec: 0, fadeOutSec: 3, curve: 'tri' as const },
  };
  const savedWithSeam = {
    id: 'saved-2', status: 'done',
    s3Key: 'audio/mastering/1700000000000_ab12_kadhal.wav',
    masterKey: 'audio/mastering/1700000000000_ab12_kadhal-master-14LUFS.wav',
    target: -14, title: 'Seamed', savedAt: '2026-08-01T10:00:00.000Z',
    edit: null, join: SEAM,
    source: { codec: 'pcm_s24le', sampleRate: 48000, channels: 2, channelLayout: 'stereo', bitDepth: 24, durationSec: 300 },
    afterLufs: -14, afterTp: -3.2, error: null,
  };

  async function reopenSeamed() {
    render(<MasteringStudio />);
    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [savedWithSeam] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saved masters/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Edit & re-master/i })); });
  }

  it('re-masters with the ORIGINAL curve and Part B edit, not rebuilt defaults', async () => {
    await reopenSeamed();
    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-9', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-9' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    const body = JSON.parse(
      mockedFetch.mock.calls.find((c) => c[0] === '/api/admin/music-lab/master' && c[1]?.method === 'POST')![1].body
    );
    expect(body.join).toMatchObject({ partBKey: SEAM.partBKey, overlapSec: 4.5, curve: 'tri' });
    expect(body.join.editB).toMatchObject({ trimStartSec: 2, trimEndSec: 150, fadeOutSec: 3 });
  });

  it('does NOT apply the old seam to a different Part B', async () => {
    // Swapping the file must not inherit the previous one's trim — that would
    // cut an unrelated section and master cleanly.
    await reopenSeamed();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Remove/i })); });

    const input = document.getElementById(
      screen.getByText(/Add Part B/i).closest('label')!.getAttribute('for')!
    ) as HTMLInputElement;
    const f = new File(['x'], 'other-b.wav', { type: 'audio/wav' });
    Object.defineProperty(f, 'size', { value: 2048 });
    mockedFetch.mockResolvedValueOnce(
      json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/zz_other.wav' })
    );
    await act(async () => { fireEvent.change(input, { target: { files: [f] } }); });

    mockedFetch.mockResolvedValueOnce(json({ success: true, jobId: 'job-9', status: 'queued' }));
    mockedFetch.mockResolvedValue(json(doneJob({ id: 'job-9' })));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);

    const body = JSON.parse(
      mockedFetch.mock.calls.find((c) => c[0] === '/api/admin/music-lab/master' && c[1]?.method === 'POST')![1].body
    );
    expect(body.join.partBKey).toBe('audio/mastering/zz_other.wav');
    expect(body.join.curve).toBe('qsin');
    expect(body.join.editB).toBeNull();
  });
});
