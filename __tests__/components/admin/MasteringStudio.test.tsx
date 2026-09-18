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
  // The seam preview's own two. A missing entry does not fail as a missing
  // icon — React renders `undefined` and the whole component throws.
  Headphones: () => <svg data-testid="i-headphones" />,
  // The release-pipeline status line's icons. A missing entry here does not
  // fail as a missing icon — React renders `undefined` and the WHOLE component
  // throws, taking every test in this file with it.
  CircleDot: () => <svg data-testid="i-circledot" />,
  Circle: () => <svg data-testid="i-circle" />,
  ArrowRight: () => <svg data-testid="i-arrowright" />,
  ExternalLink: () => <svg data-testid="i-externallink" />,
  Check: () => <svg data-testid="i-check2" />,
  // The vertical-clip button. A missing entry here does not fail as a missing
  // icon — React renders `undefined` and the WHOLE component throws, so every
  // test in this file goes red at once.
  Smartphone: () => <svg data-testid="i-smartphone" />,
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
import { MasteringStudio, buildJoinPayload, parseTagList, parseHashtags } from '@/components/admin/MasteringStudio';
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
/**
 * Route-based default responses.
 *
 * Deliberately NOT a queue of mockResolvedValueOnce values. The page makes
 * fetches whose ORDER is not fixed — the source analysis fires on upload and
 * races the next user action — so a positional queue hands the wrong body to
 * whichever call happens to arrive first. That has bitten this suite twice.
 * Tests that need a specific response still queue a Once value; everything else
 * falls through to here.
 */
function routeDefaults(job: Record<string, unknown> = doneJob(), uploadKey = 'audio/mastering/1_a_song.wav') {
  mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
    const u = String(url);
    if (u.startsWith('/api/admin/mastering/upload')) {
      return Promise.resolve(json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: uploadKey }));
    }
    if (u === '/api/admin/mastering/analyse') {
      return Promise.resolve(json({ success: true, analysisId: 'an-1', status: 'queued' }));
    }
    if (u.startsWith('/api/admin/mastering/analyse/')) {
      return Promise.resolve(json({
        success: true,
        analysis: { status: 'done', leadingSilenceSec: 0, trailingSilenceSec: 0, durationSec: 240 },
        verdicts: { fade: { state: 'steady', dropLu: 0.4, message: 'The tail holds its level' }, partBFade: null, level: null, trim: null },
      }));
    }
    if (u.startsWith('/api/admin/mastering/download')) {
      return Promise.resolve(json({ success: true, url: 'https://s3/signed', filename: 'x.wav' }));
    }
    if (u === '/api/admin/music-lab/master' && init?.method === 'POST') {
      return Promise.resolve(json({ success: true, jobId: 'job-1', status: 'queued' }));
    }
    if (u === '/api/admin/music-lab/masters') {
      return Promise.resolve(json({ success: true, masters: [] }));
    }
    if (u === '/api/admin/mastering/references') {
      // Reference-matching bank (Phase 1C UI). Default to empty so tests that
      // don't specifically exercise the picker aren't affected — a per-test
      // mockResolvedValueOnce can override with a populated list.
      return Promise.resolve(json({ success: true, references: [], count: 0 }));
    }
    return Promise.resolve(json(job));
  });
}


/**
 * Everything answers normally except the STATUS poll, which hangs until the
 * caller's signal fires and then rejects like a real aborted fetch. Used by the
 * cancel tests, which are about what an abort does to the UI.
 */
function routeWithHangingStatus(jobId: string) {
  mockedFetch.mockImplementation((url: string, init?: { method?: string; signal?: AbortSignal }) => {
    const u = String(url);
    if (u.startsWith('/api/admin/mastering/upload')) {
      return Promise.resolve(json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_a_song.wav' }));
    }
    if (u === '/api/admin/mastering/analyse') return Promise.resolve(json({ success: true, analysisId: 'an-1' }));
    // Ends the advisory analysis at once so it cannot outlive the test.
    if (u.startsWith('/api/admin/mastering/analyse/')) {
      return Promise.resolve(json({ success: true, analysis: { status: 'error' }, verdicts: null }));
    }
    if (u === '/api/admin/music-lab/master' && init?.method === 'POST') {
      return Promise.resolve(json({ success: true, jobId, status: 'queued' }));
    }
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('signal is aborted without reason', 'AbortError'))
      );
    });
  });
}

/** Back-compat name used throughout the suite. */
function primeHappyPath(job: Record<string, unknown> = doneJob()) {
  routeDefaults(job);
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

  /**
   * A radiogroup that ignores arrow keys is a radiogroup in name only — the
   * same rule MasteringWaveform already holds itself to for role="slider".
   */
  describe('target keyboard navigation', () => {
    const targets = () => ({
      t14: screen.getByRole('radio', { name: /-14 LUFS/ }),
      t16: screen.getByRole('radio', { name: /-16 LUFS/ }),
      bed: screen.getByRole('radio', { name: /Karaoke bed/i }),
    });

    it('is ONE tab stop, not one per option', () => {
      render(<MasteringStudio />);
      const { t14, t16 } = targets();
      expect(t14).toHaveAttribute('tabindex', '0'); // checked by default
      expect(t16).toHaveAttribute('tabindex', '-1');
    });

    it('an arrow key selects as it moves', () => {
      render(<MasteringStudio />);
      const { t14, t16 } = targets();
      fireEvent.keyDown(t14, { key: 'ArrowRight' });
      expect(t16).toHaveAttribute('aria-checked', 'true');
      expect(t14).toHaveAttribute('aria-checked', 'false');
      expect(t16).toHaveAttribute('tabindex', '0');
    });

    it('wraps around both ends', () => {
      render(<MasteringStudio />);
      const { t14, bed } = targets();
      // The karaoke bed is the LAST entry, so it is what ArrowLeft wraps to.
      fireEvent.keyDown(t14, { key: 'ArrowLeft' });
      expect(bed).toHaveAttribute('aria-checked', 'true');
      fireEvent.keyDown(bed, { key: 'ArrowRight' }); // wraps back to the first
      expect(t14).toHaveAttribute('aria-checked', 'true');
    });

    it('does not swallow keys that are not its own', () => {
      render(<MasteringStudio />);
      const { t14, t16 } = targets();
      fireEvent.keyDown(t14, { key: 'Tab' });
      expect(t14).toHaveAttribute('aria-checked', 'true');
      expect(t16).toHaveAttribute('aria-checked', 'false');
    });
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
    routeWithHangingStatus('job-7');

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
    routeWithHangingStatus('job-7');

    render(<MasteringStudio />);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Stop watching/i })); });

    // The job finished while we weren't looking; resuming must pick it up.
    routeDefaults(doneJob({ id: 'job-7' }));
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

  /**
   * Hearing the seam before mastering.
   *
   * The join panel's own note has always said to nudge Part B's head trim "by
   * ear" — but until this existed there was nothing to nudge against: hearing
   * the result meant mastering the whole song. The properties worth pinning are
   * that the request carries the settings CURRENTLY on screen, and that a stale
   * preview is never left playing under new numbers.
   */
  describe('hearing the seam', () => {
    async function setUpSeam() {
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
    }

    it('sends the settings currently on screen, not the ones it started with', async () => {
      await setUpSeam();
      mockedFetch.mockResolvedValueOnce(json({ success: true, previewKey: 'audio/mastering/seam/abc.mp3', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json({ success: true, status: 'ready', url: 'https://s3/seam.mp3', levelsNote: 'within 0.3 LU', levels: { mismatched: false } })
      );
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Hear the seam/i })); });

      const req = mockedFetch.mock.calls.find(
        (c) => String(c[0]) === '/api/admin/mastering/seam-preview' && c[1]?.method === 'POST'
      )!;
      const body = JSON.parse(req[1].body);
      expect(body.partAKey).toBe('audio/mastering/1_a_song.wav');
      expect(body.join).toMatchObject({
        partBKey: 'audio/mastering/1_b_partb.wav',
        overlapSec: 4.5,
        editB: expect.objectContaining({ trimStartSec: 2 }),
      });
    });

    it('plays the clip on a loop and reports what the two sides measured', async () => {
      await setUpSeam();
      mockedFetch.mockResolvedValueOnce(json({ success: true, previewKey: 'audio/mastering/seam/abc.mp3', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json({
          success: true, status: 'ready', url: 'https://s3/seam.mp3',
          levelsNote: 'Part A-s tail and Part B-s head are 3 LU apart.',
          levels: { mismatched: true, gapLu: 3 },
        })
      );
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Hear the seam/i })); });

      const audio = await screen.findByLabelText(/crossfade between Part A and Part B/i);
      expect(audio).toHaveAttribute('src', 'https://s3/seam.mp3');
      expect(audio).toHaveAttribute('loop');
      expect(screen.getByText(/3 LU apart/)).toBeInTheDocument();
    });

    it('clears the previous clip before the new one renders', async () => {
      // The one way a preview lies: the operator hears the OLD settings, judges
      // them fine, and masters something else.
      await setUpSeam();
      mockedFetch.mockResolvedValueOnce(json({ success: true, previewKey: 'audio/mastering/seam/abc.mp3', status: 'queued' }));
      mockedFetch.mockResolvedValue(json({ success: true, status: 'ready', url: 'https://s3/first.mp3', levelsNote: '', levels: {} }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Hear the seam/i })); });
      expect(await screen.findByLabelText(/crossfade between Part A/i)).toHaveAttribute('src', 'https://s3/first.mp3');

      // Now change a value and ask again; the first clip must go immediately.
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Crossfade \(seconds\)/i), { target: { value: '6' } });
      });
      mockedFetch.mockResolvedValueOnce(json({ success: true, previewKey: 'audio/mastering/seam/def.mp3', status: 'queued' }));
      mockedFetch.mockResolvedValue(json({ success: true, status: 'ready', url: 'https://s3/second.mp3', levelsNote: '', levels: {} }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Hear the seam/i })); });

      const audio = await screen.findByLabelText(/crossfade between Part A/i);
      expect(audio).toHaveAttribute('src', 'https://s3/second.mp3');
      expect(screen.queryByText('https://s3/first.mp3')).not.toBeInTheDocument();
    });

    /**
     * The measurements ride along with the preview, because the expensive half
     * — pulling both WAVs across regions — is already paid for by rendering it.
     * Three of the four things they report are ones no crossfade can fix, so
     * seeing them BEFORE tuning the crossfade is the whole point.
     */
    it('shows what the two parts measured, and lets the suggestion be applied', async () => {
      await setUpSeam();
      mockedFetch.mockResolvedValueOnce(json({ success: true, previewKey: 'audio/mastering/seam/abc.mp3', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json({
          success: true, status: 'ready', url: 'https://s3/seam.mp3',
          levelsNote: 'within 0.5 LU', levels: { mismatched: false },
          analysis: {
            a: { durationSec: 222, edgeLufs: -19.2, centroidHz: 327, chroma: new Array(12).fill(1 / 12),
                 tempo: { bpm: 176.15, periodSec: 0.3406, phaseSec: 0.065, confidence: 0.8 } },
            b: { durationSec: 224.7, edgeLufs: -18.7, centroidHz: 565, chroma: new Array(12).fill(1 / 12),
                 tempo: { bpm: 179.07, periodSec: 0.3351, phaseSec: 0.075, confidence: 0.8 }, firstOnsetSec: 0.1 },
            findings: [
              { id: 'level', level: 'ok', text: 'Level 0.5 LU apart — close enough that placement decides this seam.' },
              { id: 'tempo', level: 'warn', text: 'Tempo 1.66% apart — keep the crossfade SHORT; a longer one drifts further.' },
            ],
            suggestion: { partBStartSec: 0.1, overlapSec: 2.11, alternatives: [2.45], reason: 'on Part A’s beat grid, and short because the tempos differ' },
            joinable: false,
          },
        })
      );
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Hear the seam/i })); });

      expect(await screen.findByText(/176\.2 BPM/)).toBeInTheDocument();
      expect(screen.getByText(/179\.1 BPM/)).toBeInTheDocument();
      expect(screen.getByText(/keep the crossfade SHORT/i)).toBeInTheDocument();

      // Applying the suggestion writes it into the join fields.
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Use these/i })); });
      expect((screen.getByLabelText(/Crossfade \(seconds\)/i) as HTMLInputElement).value).toBe('2.11');
      expect((screen.getByLabelText(/Part B starts at/i) as HTMLInputElement).value).toBe('0.1');
    });

    it('still plays the clip when no analysis came back', async () => {
      // Previews rendered before this existed, and any whose analysis failed.
      await setUpSeam();
      mockedFetch.mockResolvedValueOnce(json({ success: true, previewKey: 'audio/mastering/seam/abc.mp3', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json({ success: true, status: 'ready', url: 'https://s3/seam.mp3', levelsNote: '', levels: {} })
      );
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Hear the seam/i })); });

      expect(await screen.findByLabelText(/crossfade between Part A/i)).toBeInTheDocument();
      expect(screen.queryByText(/Use these/i)).not.toBeInTheDocument();
    });

    it('reports a refusal instead of spinning', async () => {
      await setUpSeam();
      mockedFetch.mockResolvedValueOnce(
        json({ success: false, error: "the 4.5s crossfade is longer than Part B" }, false, 409)
      );
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Hear the seam/i })); });

      expect(await screen.findByRole('alert')).toHaveTextContent(/longer than Part B/);
      expect(screen.getByRole('button', { name: /Hear the seam/i })).toBeEnabled();
    });
  });

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
      json(
        savedDoneJob({
          videoKey: 'audio/mastering/1_a_song-master-14LUFS-2160p.mp4',
          videoRenderedAt: '2026-09-15T00:00:00.000Z',
        })
      )
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

  /**
   * The vertical clip. It shares the cover and the gate with the video but is
   * NOT downstream of it — the surplus songs that want a short are the ones
   * that never get a YouTube video at all, so a short must not require one.
   */
  describe('the vertical short', () => {
    it('does not need a rendered video first', async () => {
      await masterAndSave();
      await addCover();
      expect(screen.getByRole('button', { name: /Make a short/ })).toBeEnabled();
      // ...and nothing has been rendered.
      expect(screen.queryByRole('button', { name: /Download MP4/ })).not.toBeInTheDocument();
    });

    it('needs a cover before it will cut', async () => {
      await masterAndSave();
      expect(screen.getByRole('button', { name: /Make a short/ })).toBeDisabled();
      await addCover();
      expect(screen.getByRole('button', { name: /Make a short/ })).toBeEnabled();
    });

    it('sends the cover, then offers the clip and says where it was cut from', async () => {
      await masterAndSave();
      await addCover();

      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json(
          savedDoneJob({
            shortKey: 'audio/mastering/1_a_song-master-14LUFS-short-1920.mp4',
            shortRenderedAt: '2026-09-16T00:00:00.000Z',
            shortStartSec: 96,
            shortSeconds: 30,
          })
        )
      );
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

      const req = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))!;
      expect(JSON.parse(req[1].body)).toEqual({ coverKey: 'audio/mastering/1_c_cover.jpg' });
      expect(await screen.findByRole('button', { name: /Download short/ })).toBeInTheDocument();
      // The position is shown so a clip that opens in the wrong place can be
      // diagnosed without re-measuring the track.
      expect(screen.getByText(/30s from 1:36/)).toBeInTheDocument();
    });

    it('downloads under a name that does not call it a master', async () => {
      // A file named "(Master -14 LUFS).mp4" is how a 30s clip gets uploaded
      // as the full song.
      await masterAndSave();
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Name this master/i), { target: { value: 'காதல் மழை' } });
      });
      await addCover();
      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json(
          savedDoneJob({
            shortKey: 'audio/mastering/1_a_song-master-14LUFS-short-1920.mp4',
            shortRenderedAt: '2026-09-16T00:00:00.000Z',
            shortStartSec: 96,
            shortSeconds: 30,
          })
        )
      );
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

      const btn = await screen.findByRole('button', { name: /Download short/ });
      mockedFetch.mockResolvedValueOnce(json({ success: true, url: 'https://s3/presigned' }));
      await act(async () => { fireEvent.click(btn); });

      const req = mockedFetch.mock.calls.find((c) => String(c[0]).includes('/mastering/download'))!;
      expect(decodeURIComponent(String(req[0]))).toContain('(Short)');
      expect(decodeURIComponent(String(req[0]))).not.toContain('Master -14 LUFS');
    });

    it('reports a failure instead of spinning forever', async () => {
      await masterAndSave();
      await addCover();
      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      mockedFetch.mockResolvedValue(json(savedDoneJob({ shortError: 'could not measure the track' })));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

      expect(await screen.findByRole('alert')).toHaveTextContent(/could not measure the track/);
      expect(screen.getByRole('button', { name: /Make a short/ })).toBeEnabled();
    });

    /**
     * Choosing the window by lyric rather than by loudness. The operator's own
     * method is to pick the best lines, which the energy pass cannot find.
     */
    describe('choosing the window', () => {
      async function primeShortResponse() {
        mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
        mockedFetch.mockResolvedValue(
          json(
            savedDoneJob({
              shortKey: 'audio/mastering/1_a_song-master-14LUFS-short-1920.mp4',
              shortRenderedAt: '2026-09-16T00:00:00.000Z',
              shortStartSec: 96,
              shortSeconds: 45,
              shortPicked: true,
            })
          )
        );
      }

      it('sends no window at all until one is set', async () => {
        // Absence is the signal for "you decide" — zeroes would read as
        // "start at 0:00 for 0s".
        await masterAndSave();
        await addCover();
        await primeShortResponse();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

        const body = JSON.parse(mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))![1].body);
        expect(body).toEqual({ coverKey: 'audio/mastering/1_c_cover.jpg' });
      });

      it('takes typed start and end times in mm:ss', async () => {
        // A lyric sheet reads "this line is at 1:36, that one ends at 2:21" —
        // the operator should never do the subtraction.
        await masterAndSave();
        await addCover();
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: '1:36' } });
        });
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '2:21' } });
        });

        await primeShortResponse();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

        const body = JSON.parse(mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))![1].body);
        expect(body).toMatchObject({ startSec: 96, seconds: 45 });
      });

      /**
       * The ceiling that was wrong. 60s was a convention applied over the
       * channel's own evidence; two minutes is what this song needed.
       */
      it('accepts a two-minute clip', async () => {
        await masterAndSave();
        await addCover();
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: '1:36' } });
        });
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '3:36' } });
        });
        expect(screen.getByText(/Cutting/)).toHaveTextContent('2:00');

        await primeShortResponse();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

        const body = JSON.parse(mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))![1].body);
        expect(body).toMatchObject({ startSec: 96, seconds: 120 });
      });

      it('says why a pair cannot be used, and sends nothing while it cannot', async () => {
        await masterAndSave();
        await addCover();
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: '2:00' } });
        });
        // An end before the start, then one that is too short a span.
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '1:00' } });
        });
        expect(screen.getByText(/end must come after the start/i)).toBeInTheDocument();

        await act(async () => {
          fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '2:10' } });
        });
        expect(screen.getByText(/shortest clip is 30s/i)).toBeInTheDocument();
        // And the fields say so themselves, not just the page.
        expect(screen.getByLabelText(/End at/i)).toHaveAttribute('aria-invalid', 'true');

        await primeShortResponse();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });
        const body = JSON.parse(mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))![1].body);
        expect(body).toEqual({ coverKey: 'audio/mastering/1_c_cover.jpg' });
      });

      it('warns that a clip past 90s is not a Facebook Reel, without refusing it', async () => {
        await masterAndSave();
        await addCover();
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: '0:10' } });
        });
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '2:10' } });
        });
        expect(screen.getByText(/Facebook Reels will not/i)).toBeInTheDocument();
        // A warning, not a refusal — the window is still sent.
        expect(screen.getByLabelText(/End at/i)).not.toHaveAttribute('aria-invalid');
      });

      /**
       * The old Length dropdown is gone. It offered 30-60s in 5s steps, which
       * could not express a two-minute clip at all — the reason it read as
       * "not functioning" rather than merely limited.
       */
      it('offers no fixed-length control at all', () => {
        expect(screen.queryByLabelText(/^Length$/i)).not.toBeInTheDocument();
      });

      it('clearing the field goes back to letting it pick', async () => {
        await masterAndSave();
        await addCover();
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: '1:36' } });
        });
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '2:21' } });
        });
        expect(screen.getByRole('button', { name: /Let it pick/i })).toBeInTheDocument();

        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /Let it pick/i }));
        });

        await primeShortResponse();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

        const body = JSON.parse(mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))![1].body);
        expect(body).toEqual({ coverKey: 'audio/mastering/1_c_cover.jpg' });
      });

      it('an unreadable time drops the whole window rather than starting at 0:00', async () => {
        // A short that silently opens at the top of the song is exactly what
        // this picker exists to prevent.
        await masterAndSave();
        await addCover();
        await act(async () => {
          fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: 'chorus' } });
        });

        await primeShortResponse();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make a short/ })); });

        const body = JSON.parse(mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))![1].body);
        expect(body).toEqual({ coverKey: 'audio/mastering/1_c_cover.jpg' });
        expect('startSec' in body).toBe(false);
      });
    });
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

/**
 * Audit 2026-08-06 — a song's IDENTITY must not survive into the next song.
 *
 * `masterName` is not cosmetic. It becomes the saved title, and the title
 * becomes BOTH the archive key and the public filename on tamilagaval.com
 * (publishKeyForTitle). So a name left over from the previous song publishes
 * this one under that name — in the lossless archive and on the live site.
 * The cover has the same shape: a leftover cover renders the wrong artwork
 * into the uploaded video. Neither produces an error.
 */
describe('per-song identity resets with the source', () => {
  const named = () => screen.getByLabelText(/Name this master/i) as HTMLInputElement;

  async function masterOnce(key: string) {
    routeDefaults(doneJob({ mp3Key: 'audio/mastering/x-master-14LUFS.mp3', mp3Tp: -3.5 }), key);
    await uploadA();
    await waitFor(() => expect(screen.getByRole('button', { name: /Master to -14/ })).toBeEnabled());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);
  }

  it('does NOT carry the previous song\'s name into the next one', async () => {
    render(<MasteringStudio />);
    await masterOnce('audio/mastering/1_a_songA.wav');
    await act(async () => { fireEvent.change(named(), { target: { value: 'அந்தி மேகமே' } }); });
    expect(named().value).toBe('அந்தி மேகமே');

    // A different file — no Start over, just a new pick.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start over/i })); });
    await masterOnce('audio/mastering/2_b_songB.wav');

    expect(named().value).toBe('');
  });

  it('does not offer the previous song\'s cover for the next render', async () => {
    render(<MasteringStudio />);
    await masterOnce('audio/mastering/1_a_songA.wav');
    mockedFetch.mockResolvedValueOnce(json({ success: true, title: 'A' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save to library/ })); });
    await screen.findByRole('button', { name: /Saved to library/ });

    const cover = screen.getByLabelText(/Cover image/i) as HTMLInputElement;
    const img = new File(['x'], 'coverA.jpg', { type: 'image/jpeg' });
    mockedFetch.mockResolvedValueOnce(json({ success: true, uploadUrl: 'https://s3/u', fields: {}, key: 'audio/mastering/coverA.jpg' }));
    await act(async () => { fireEvent.change(cover, { target: { files: [img] } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: /Render video/ })).toBeEnabled());

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Start over/i })); });
    await masterOnce('audio/mastering/2_b_songB.wav');
    mockedFetch.mockResolvedValueOnce(json({ success: true, title: 'B' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save to library/ })); });
    await screen.findByRole('button', { name: /Saved to library/ });

    // Render must be unavailable until a cover is chosen FOR THIS song.
    expect(screen.getByRole('button', { name: /Render video/ })).toBeDisabled();
  });
});

/**
 * Rendering a video for a master saved in an earlier session.
 *
 * The inline render panel is gated on `savedAt && job.masterKey`, and `savedAt`
 * is set in exactly one place — the moment Save is clicked in THIS session.
 * `reopenMaster` deliberately clears it, because a re-open is a new run against
 * the same source. The consequence was that a master saved yesterday could
 * never be rendered: its masterKey was in S3 and its videoKey column was in
 * DynamoDB, and nothing on the page could reach either.
 *
 * This is the same defect the MP3 button already fixed for the web file. These
 * tests pin the video half.
 */
describe('rendering from the saved-masters library', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'saved-vid-1',
    status: 'done',
    s3Key: 'audio/mastering/1700000000000_ab12_kadhal.wav',
    masterKey: 'audio/mastering/1700000000000_ab12_kadhal-master-14LUFS.wav',
    mp3Key: null,
    videoKey: null,
    target: -14,
    title: 'காதல் மழை',
    savedAt: '2026-08-01T10:00:00.000Z',
    edit: null, join: null, source: null,
    afterLufs: -14, afterTp: -3.2, beforeLra: 3, afterLra: 3,
    error: null,
    ...over,
  });

  async function openLibrary(job: Record<string, unknown> = row()) {
    render(<MasteringStudio />);
    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [job] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saved masters/i })); });
    // Same readiness signal the re-open tests use — the row's own control.
    await screen.findByRole('button', { name: /Edit & re-master/i });
  }

  /**
   * The row used to require inference: an MP3 link meant it had been encoded,
   * and whether the song had reached YouTube was not shown at all. That cost a
   * wasted 3-minute render on a song already scheduled to premiere.
   */
  it('states where the song has got to, and the next thing to do', async () => {
    await openLibrary(row({ mp3Key: null, videoKey: null }));
    expect(await screen.findByText(/Encode the web MP3/i)).toBeInTheDocument();
  });

  it('a song already on YouTube is never told to render or upload again', async () => {
    await openLibrary(
      row({
        mp3Key: 'audio/mastering/x.mp3',
        coverKey: 'audio/mastering/c.jpg',
        videoKey: 'audio/mastering/x-1440p.mp4',
        shortKey: 'audio/mastering/x-short-1920.mp4',
        youtubeVideoId: 'abc123',
      })
    );
    // The remaining step is Studio-only, and the row has to say so rather than
    // implying the release is finished.
    expect(await screen.findByText(/Pin the comment in YouTube Studio/i)).toBeInTheDocument();
    expect(screen.queryByText(/Render the video/i)).not.toBeInTheDocument();
  });

  it('offers the finished MP4 on a row that already has one', async () => {
    // Previously reachable only from the run that produced it.
    await openLibrary(row({ videoKey: 'audio/mastering/1_a-master-14LUFS-1440p.mp4' }));
    expect(screen.getByRole('button', { name: /^Video$/ })).toBeInTheDocument();
  });

  it('offers a render on a saved master that has none yet', async () => {
    await openLibrary();
    expect(await screen.findByRole('button', { name: /Video or short for காதல் மழை/ })).toBeInTheDocument();
  });

  it('does not offer a render on a row whose master file is gone', async () => {
    await openLibrary(row({ masterKey: null }));
    expect(screen.queryByRole('button', { name: /Video or short for/ })).not.toBeInTheDocument();
  });

  it('shows "Re-render" button on a row that already has a video', async () => {
    // Regression guard: the render button must stay visible even after a successful render,
    // so a bad render can be redone. This test fails if the gate reverts to m.masterKey && !m.videoKey.
    await openLibrary(row({ videoKey: 'audio/mastering/1_a-master-14LUFS-1440p.mp4' }));
    const renderBtn = screen.getByRole('button', { name: /Video or short for காதல் மழை/ });
    expect(renderBtn).toBeInTheDocument();
    expect(renderBtn).toHaveTextContent('Video / short');
  });

  it('shows "Render video" button on a row that has no video yet', async () => {
    // The complementary case: a new render should show the initial label, not "Re-render".
    await openLibrary();
    const renderBtn = screen.getByRole('button', { name: /Video or short for காதல் மழை/ });
    expect(renderBtn).toBeInTheDocument();
    expect(renderBtn).toHaveTextContent('Make video or short');
  });

  it('sends the row-s own job id and cover, not the active job-s', async () => {
    await openLibrary();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
    });

    const input = await screen.findByLabelText(/Cover for காதல் மழை/i);
    mockedFetch.mockResolvedValueOnce(
      json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
    );
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
    });

    mockedFetch.mockResolvedValueOnce(json({ success: true, videoKey: 'v', height: 1440, status: 'queued' }));
    mockedFetch.mockResolvedValue(
      json(row({ videoKey: 'audio/mastering/done-1440p.mp4', videoRenderedAt: '2026-09-15T00:00:00.000Z' }))
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Render video/ }));
    });

    const req = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/render'))!;
    expect(String(req[0])).toContain('/master/saved-vid-1/render');
    expect(JSON.parse(req[1].body).coverKey).toBe('audio/mastering/1_c_cover.jpg');
  });

  it('does not announce success from a stale videoRenderedAt on a re-render', async () => {
    // Regression guard for "a re-render reports success before it has
    // started": the render route never clears the PREVIOUS videoKey /
    // videoRenderedAt on enqueue, so attempt 0 of the poll can read the old
    // render's leftovers. A row that already has a video (videoRenderedAt
    // T0) is re-rendered; the first poll comes back with that SAME
    // videoRenderedAt (a stale read), and only the second poll carries a
    // new one. This must not settle on the stale read — it must keep
    // polling until videoRenderedAt actually changes.
    const oldRenderedAt = '2026-01-01T00:00:00.000Z';
    const oldVideoKey = 'audio/mastering/1_a-master-14LUFS-1440p.mp4';
    const newRenderedAt = '2026-09-15T00:00:00.000Z';
    const newVideoKey = 'audio/mastering/1_a-master-14LUFS-1440p-NEW.mp4';

    await openLibrary(row({ videoKey: oldVideoKey, videoRenderedAt: oldRenderedAt }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
    });

    const input = await screen.findByLabelText(/Cover for காதல் மழை/i);
    mockedFetch.mockResolvedValueOnce(
      json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
    );
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
    });

    // POST /render — accepted, queued. The route does NOT clear the job's
    // existing videoKey/videoRenderedAt.
    mockedFetch.mockResolvedValueOnce(json({ success: true, videoKey: 'v', height: 1440, status: 'queued' }));
    // Poll attempt 0: a stale read — same videoRenderedAt as before this
    // render started. This must NOT be treated as completion.
    mockedFetch.mockResolvedValueOnce(json(row({ videoKey: oldVideoKey, videoRenderedAt: oldRenderedAt })));
    // Poll attempt 1 (after the interval): the real completion, with a
    // videoRenderedAt that has actually changed.
    mockedFetch.mockResolvedValue(json(row({ videoKey: newVideoKey, videoRenderedAt: newRenderedAt })));

    // The click kicks off an un-awaited async chain (POST, then a real
    // multi-second poll interval before attempt 1) — fire it and wait for
    // the row-render panel to close, which only happens once `startRender`
    // actually resolves with a completed job. That is the unambiguous
    // "fully done" signal, well past the default waitFor window since
    // attempt 1 only fires after the real 4s poll interval.
    fireEvent.click(screen.getByRole('button', { name: /^Render video/ }));
    await waitFor(
      () => expect(screen.queryByRole('button', { name: /^Render video/ })).not.toBeInTheDocument(),
      { timeout: 8000, interval: 250 }
    );

    // Now that the render has genuinely finished, the status route must have
    // been polled MORE than once: settling on attempt 0's stale response
    // alone (never re-polling) is exactly the bug this guards against.
    const statusCalls = mockedFetch.mock.calls.filter((c) => String(c[0]).endsWith('/saved-vid-1'));
    expect(statusCalls.length).toBeGreaterThan(1);

    // And the row must have picked up the SECOND poll's key, never the
    // stale first one — clicking "Video" must download the NEW file.
    const videoBtn = screen.getByRole('button', { name: /^Video$/ });
    mockedFetch.mockResolvedValueOnce(json({ success: true, url: 'https://s3/presigned' }));
    await act(async () => {
      fireEvent.click(videoBtn);
    });
    const downloadReq = mockedFetch.mock.calls.find((c) => String(c[0]).includes('/mastering/download'))!;
    expect(String(downloadReq[0])).toContain(encodeURIComponent(newVideoKey));
    expect(String(downloadReq[0])).not.toContain(encodeURIComponent(oldVideoKey));
  }, 15000);

  /**
   * The short has to be reachable from here too, and this is the whole reason
   * why: the inline panel is gated on `savedAt`, which only this session's Save
   * sets. The songs that want a short are the SURPLUS ones — mastered days ago,
   * never given a YouTube slot — so a short reachable only from the mastering
   * session would be reachable for exactly the wrong songs.
   */
  describe('cutting a short from the library', () => {
    /**
     * The two actions must NAME WHAT THEY PRODUCE.
     *
     * Raj pressed the video button while trying to cut a short and got a
     * 3-minute 1440p render instead. The buttons sat side by side, the video
     * one read only "Render", and the control that opened the strip said
     * "Render video" — so the whole panel read as being about video.
     */
    it('names what each button produces, so neither can be mistaken for the other', async () => {
      await openLibrary();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
      });

      const video = screen.getByRole('button', { name: /^Render video/ });
      const short = screen.getByRole('button', { name: /^Make vertical short$/ });
      expect(video).toBeInTheDocument();
      expect(short).toBeInTheDocument();
      // Neither label may be a prefix of the other, or a regex — or an eye —
      // can match the wrong one.
      expect(video.textContent).not.toBe(short.textContent);
      expect(video).toHaveTextContent(/video/i);
      expect(short).toHaveTextContent(/short/i);
      // And the video button says which size it will produce.
      expect(video).toHaveTextContent(/1440p/);
    });

    it('offers the finished clip on a row that already has one', async () => {
      await openLibrary(row({ shortKey: 'audio/mastering/1_a-master-14LUFS-short-1920.mp4' }));
      expect(screen.getByRole('button', { name: /^Short$/ })).toBeInTheDocument();
    });

    it('sends the row-s own job id and cover to the short route', async () => {
      await openLibrary();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
      });

      const input = await screen.findByLabelText(/Cover for காதல் மழை/i);
      mockedFetch.mockResolvedValueOnce(
        json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
      );
      await act(async () => {
        fireEvent.change(input, { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
      });

      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json(
          row({
            shortKey: 'audio/mastering/done-short-1920.mp4',
            shortRenderedAt: '2026-09-16T00:00:00.000Z',
            shortStartSec: 96,
            shortSeconds: 30,
          })
        )
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Make vertical short$/ }));
      });

      const req = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))!;
      expect(String(req[0])).toContain('/master/saved-vid-1/short');
      expect(JSON.parse(req[1].body).coverKey).toBe('audio/mastering/1_c_cover.jpg');
      // The row picks up the new clip without a list reload.
      expect(await screen.findByRole('button', { name: /^Short$/ })).toBeInTheDocument();
    });

    it('does not announce success from a stale shortRenderedAt on a re-cut', async () => {
      // The same trap the video re-render guard exists for: the short route
      // never clears the job's previous shortKey/shortRenderedAt on enqueue, so
      // poll attempt 0 can read the PREVIOUS clip's leftovers and settle on
      // them before the new encode has started.
      const oldAt = '2026-01-01T00:00:00.000Z';
      const oldKey = 'audio/mastering/1_a-master-14LUFS-short-1920.mp4';
      const newAt = '2026-09-16T00:00:00.000Z';
      const newKey = 'audio/mastering/1_a-master-14LUFS-short-1920-NEW.mp4';

      await openLibrary(row({ shortKey: oldKey, shortRenderedAt: oldAt }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
      });
      const input = await screen.findByLabelText(/Cover for காதல் மழை/i);
      mockedFetch.mockResolvedValueOnce(
        json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
      );
      await act(async () => {
        fireEvent.change(input, { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
      });

      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      // Attempt 0: a stale read. Must NOT be treated as completion.
      mockedFetch.mockResolvedValueOnce(json(row({ shortKey: oldKey, shortRenderedAt: oldAt })));
      // Attempt 1, after the real poll interval: the actual completion.
      mockedFetch.mockResolvedValue(json(row({ shortKey: newKey, shortRenderedAt: newAt })));

      // A row that already has a clip offers "Re-cut short", not "Make short".
      // The panel closes only once startShort resolves with a finished job.
      fireEvent.click(screen.getByRole('button', { name: /^Re-cut vertical short$/ }));
      await waitFor(
        () => expect(screen.queryByRole('button', { name: /^Re-cut vertical short$/ })).not.toBeInTheDocument(),
        { timeout: 8000, interval: 250 }
      );

      const statusCalls = mockedFetch.mock.calls.filter((c) => String(c[0]).endsWith('/saved-vid-1'));
      expect(statusCalls.length).toBeGreaterThan(1);

      // And the row carries the SECOND poll's key, never the stale first one.
      mockedFetch.mockResolvedValueOnce(json({ success: true, url: 'https://s3/presigned' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Short$/ }));
      });
      const dl = mockedFetch.mock.calls.find((c) => String(c[0]).includes('/mastering/download'))!;
      expect(String(dl[0])).toContain(encodeURIComponent(newKey));
      expect(String(dl[0])).not.toContain(encodeURIComponent(oldKey));
    }, 15000);

    /**
     * The library row is where the songs that want a short actually live — the
     * inline panel is gated on `savedAt`, which only this session's Save sets.
     * Shipping the picker without these was a real gap: from the library the
     * only way to set a window was the player's button, and a timestamp read
     * off a lyric sheet could not be typed at all.
     */
    it('lets the window be TYPED on the row, not only dragged in the player', async () => {
      await openLibrary();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
      });
      const input = await screen.findByLabelText(/Cover for காதல் மழை/i);
      mockedFetch.mockResolvedValueOnce(
        json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
      );
      await act(async () => {
        fireEvent.change(input, { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
      });

      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: '3:42' } });
      });
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '5:42' } });
      });

      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json(row({ shortKey: 'audio/mastering/done-short-1920.mp4', shortRenderedAt: '2026-09-16T00:00:00.000Z' }))
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Make vertical short$/ }));
      });

      const body = JSON.parse(mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))![1].body);
      expect(body).toMatchObject({ startSec: 222, seconds: 120 });
    });

    /**
     * ⚠️ A window belongs to the master it was chosen for.
     *
     * The first cut shared one {startSec, seconds} across every row, so a
     * window set while auditioning one song silently applied to whichever row
     * was rendered next — a clip cut from the wrong part of a different song,
     * with nothing on screen saying so.
     */
    it('does not apply one master-s window to a different master', async () => {
      const other = row({ id: 'saved-vid-2', title: 'வேறு பாடல்' });
      render(<MasteringStudio />);
      mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [row(), other] }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saved masters/i })); });
      await screen.findByRole('button', { name: /Video or short for காதல் மழை/ });

      // Set a window on the FIRST row.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
      });
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Start at/i), { target: { value: '3:42' } });
      });
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/End at/i), { target: { value: '4:42' } });
      });

      // Now open the SECOND row. Its field must be empty, not inherited.
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Video or short for வேறு பாடல்/ }));
      });
      const secondStart = screen.getByLabelText(/Start at/i) as HTMLInputElement;
      expect(secondStart.value).toBe('');

      // And rendering it must send no window at all.
      mockedFetch.mockResolvedValueOnce(
        json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
      );
      await act(async () => {
        fireEvent.change(screen.getByLabelText(/Cover for வேறு பாடல்/i), {
          target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] },
        });
      });
      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json({ ...other, shortRenderedAt: '2026-09-16T00:00:00.000Z' })
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Make vertical short$/ }));
      });

      const req = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/short'))!;
      expect(String(req[0])).toContain('/master/saved-vid-2/short');
      expect(JSON.parse(req[1].body)).toEqual({ coverKey: 'audio/mastering/1_c_cover.jpg' });
    });

    it('never posts a short to the render route, or a render to the short route', async () => {
      // Two buttons, one cover, adjacent in the DOM — a crossed handler would
      // look exactly like success and silently produce the wrong file.
      await openLibrary();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Video or short for காதல் மழை/ }));
      });
      const input = await screen.findByLabelText(/Cover for காதல் மழை/i);
      mockedFetch.mockResolvedValueOnce(
        json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key: 'audio/mastering/1_c_cover.jpg' })
      );
      await act(async () => {
        fireEvent.change(input, { target: { files: [new File(['x'], 'c.jpg', { type: 'image/jpeg' })] } });
      });

      mockedFetch.mockResolvedValueOnce(json({ success: true, shortKey: 's', status: 'queued' }));
      mockedFetch.mockResolvedValue(
        json(row({ shortKey: 'audio/mastering/done-short-1920.mp4', shortRenderedAt: '2026-09-16T00:00:00.000Z' }))
      );
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Make vertical short$/ }));
      });

      expect(mockedFetch.mock.calls.filter((c) => String(c[0]).endsWith('/render'))).toHaveLength(0);
    });
  });
});

/**
 * Upload to YouTube, from the page's side.
 *
 * The worker does the upload and the planner owns the refusals; only this layer
 * can show that the operator sees the picture and the FULL description before
 * pressing the button, that what YouTube is holding is read back rather than
 * echoed, that a check which could not run never reads as a pass, and that the
 * panel never implies the release is finished when two Studio-only steps remain.
 */
describe('upload to YouTube', () => {
  const RENDERED = 'audio/mastering/1_a_song-master-14LUFS-1440p.mp4';
  const readyJob = (over: Record<string, unknown> = {}) =>
    doneJob({
      mp3Key: 'audio/mastering/1_a_song-master-14LUFS.mp3',
      mp3Tp: -3.5,
      videoKey: RENDERED,
      coverKey: 'audio/mastering/1_c_cover.jpg',
      videoRenderedAt: '2026-09-15T00:00:00.000Z',
      updatedAt: 't0',
      uploadStatus: null,
      youtubeVideoId: null,
      uploadedToYoutubeAt: null,
      uploadError: null,
      ...over,
    });

  /** A release check as the route answers it, read-back included. */
  const checkBody = (over: Record<string, unknown> = {}) => ({
    videoId: 'abcdefghijk',
    title: 'ஒரு பாடல் | Oru Paadal',
    blockers: 0,
    gaps: 1,
    notes: 0,
    notChecked: 1,
    ready: false,
    captionsChecked: true,
    findings: [
      { id: 'tag-count', severity: 'gap', title: 'Only 2 tags', detail: 'Ten or more is the target.' },
      {
        id: 'release-density',
        severity: 'not-checked',
        title: 'Release density not checked',
        detail: 'No sibling releases were readable, so the rule never ran.',
      },
    ],
    stored: {
      duration: 'PT4M14S',
      durationSeconds: 254,
      definition: 'hd',
      privacyStatus: 'private',
      categoryId: '10',
      tagCount: 24,
      defaultLanguage: 'ta',
      defaultAudioLanguage: 'ta',
      thumbnail: { name: 'maxres', url: 'https://i.ytimg.com/x.jpg', width: 1280, height: 720 },
      playlistIds: ['PL-all', 'PL-latest'],
    },
    ...over,
  });

  /** Master + save with a job that already carries a rendered MP4. */
  async function openPanel(job: Record<string, unknown> = readyJob()) {
    primeHappyPath(job);
    render(<MasteringStudio />);
    await uploadA();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    await screen.findByText(/3 · Result/);
    mockedFetch.mockResolvedValueOnce(json({ success: true, title: 'One' }));
    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save to library/ })); });
    await screen.findByRole('button', { name: /Saved to library/ });
    // A title is required — the route rejects a body without one, so the
    // button stays disabled until there is something to publish under.
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Video title/i), {
        target: { value: 'ஒரு பாடல் | Oru Paadal' },
      });
    });
  }

  /**
   * Answers for the upload phase. `polls` are the status responses AFTER the
   * POST, in order; the last one repeats, so a test can hand back a stale row
   * first and a finished one second.
   */
  function primeUploadPhase(polls: Record<string, unknown>[], check: unknown = checkBody()) {
    const queue = [...polls];
    mockedFetch.mockImplementation((url: string, init?: { method?: string }) => {
      const u = String(url);
      if (u.endsWith('/youtube') && init?.method === 'POST') {
        return Promise.resolve(json({ success: true, status: 'queued' }, true, 202));
      }
      if (u.startsWith('/api/admin/youtube/release-check')) return Promise.resolve(json(check));
      if (u.startsWith('/api/admin/mastering/download')) {
        return Promise.resolve(json({ success: true, url: 'https://s3/signed' }));
      }
      return Promise.resolve(json(queue.length > 1 ? queue.shift()! : queue[0]));
    });
  }

  it('shows the picture and the FULL assembled description before uploading', async () => {
    // The two things a bad release got past: nobody saw the frame, and nobody
    // saw the text that was actually going to be published.
    await openPanel();
    const frame = await screen.findByAltText(/Cover art the video was rendered from/i);
    expect(frame).toHaveAttribute('src', 'https://s3/signed');

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Your description/i), {
        target: { value: 'மழையின் நினைவுகள்.' },
      });
      fireEvent.change(screen.getByLabelText(/Hashtags/i), { target: { value: 'tamilagaval song' } });
    });

    const preview = screen.getByLabelText('Assembled description preview');
    expect(preview).toHaveTextContent('மழையின் நினைவுகள்.');
    // The tail the operator does not own, and cannot edit away.
    expect(preview).toHaveTextContent('© 2026 TamilAgaval / Raj');
    expect(preview).toHaveTextContent('#tamilagaval #song');
  });

  it('sends the assembled description and parsed tags, not the raw body', async () => {
    await openPanel();
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Video title/i), { target: { value: 'ஒரு பாடல்' } });
      fireEvent.change(screen.getByLabelText(/Your description/i), { target: { value: 'body text' } });
      fireEvent.change(screen.getByLabelText(/^Tags/i), { target: { value: 'tamil song, , melody' } });
    });

    primeUploadPhase([
      readyJob({
        updatedAt: 't1',
        uploadStatus: 'uploaded',
        youtubeVideoId: 'abcdefghijk',
        uploadedToYoutubeAt: '2026-09-15T10:00:00.000Z',
      }),
    ]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Upload to YouTube/ })); });

    const req = mockedFetch.mock.calls.find((c) => String(c[0]).endsWith('/youtube'))!;
    const sent = JSON.parse(req[1].body);
    expect(sent.title).toBe('ஒரு பாடல்');
    expect(sent.tags).toEqual(['tamil song', 'melody']);
    expect(sent.description).toContain('body text');
    expect(sent.description).toContain('© 2026 TamilAgaval / Raj');
    expect(sent.playlistIds).toHaveLength(2);
  });

  it('states the two Studio-only steps and links to Studio', async () => {
    // Not decorative copy: the Data API cannot create a Premiere and cannot pin
    // a comment, so "uploaded" is never "released".
    await openPanel();
    primeUploadPhase([
      readyJob({
        updatedAt: 't1',
        uploadStatus: 'uploaded',
        youtubeVideoId: 'abcdefghijk',
        uploadedToYoutubeAt: '2026-09-15T10:00:00.000Z',
      }),
    ]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Upload to YouTube/ })); });

    expect(await screen.findByText(/Two steps remain in YouTube Studio/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in YouTube Studio/ })).toHaveAttribute(
      'href',
      'https://studio.youtube.com/video/abcdefghijk/edit'
    );
  });

  it('shows what YouTube stored, not what was sent', async () => {
    await openPanel();
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Tags/i), { target: { value: 'one, two' } });
    });
    primeUploadPhase([
      readyJob({
        updatedAt: 't1',
        uploadStatus: 'uploaded',
        youtubeVideoId: 'abcdefghijk',
        uploadedToYoutubeAt: '2026-09-15T10:00:00.000Z',
      }),
    ]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Upload to YouTube/ })); });

    // 24 tags is what the API is holding; 2 is what this form sent.
    const readback = (await screen.findByText(/What YouTube stored/)).closest('div')!;
    expect(readback).toHaveTextContent('24');
    expect(readback).toHaveTextContent('hd');
    expect(readback).toHaveTextContent('4:14');
    expect(readback).toHaveTextContent('maxres · 1280×720');
    expect(readback).toHaveTextContent('ta · audio ta');
  });

  it('renders a not-checked finding as not run — never as a pass, never as a problem', async () => {
    await openPanel();
    primeUploadPhase([
      readyJob({
        updatedAt: 't1',
        uploadStatus: 'uploaded',
        youtubeVideoId: 'abcdefghijk',
        uploadedToYoutubeAt: '2026-09-15T10:00:00.000Z',
      }),
    ]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Upload to YouTube/ })); });

    const notChecked = await screen.findByText('Release density not checked');
    const group = notChecked.closest('details')!;
    expect(group).toHaveTextContent(/1 check not run/);
    // The actionable gap is NOT inside that group — a check that did not run
    // must not be filed with the problems either.
    expect(group).not.toHaveTextContent('Only 2 tags');
    expect(screen.getByText('Only 2 tags').closest('details')).toBeNull();
  });

  it('does not report the PREVIOUS attempt as this attempt', async () => {
    // The same trap the render poll was fixed for, one field over: a retry
    // arrives with uploadStatus 'failed' and the old error already on the row,
    // so a poll that discriminates on "is it terminal" announces the old
    // failure instantly. The discriminator must be a value that CHANGED.
    await openPanel(readyJob({ uploadStatus: 'failed', uploadError: 'the previous attempt died' }));
    primeUploadPhase([
      // attempt 0 — the stale row, unchanged updatedAt
      readyJob({ updatedAt: 't0', uploadStatus: 'failed', uploadError: 'the previous attempt died' }),
      // attempt 1 — this attempt's real outcome
      readyJob({
        updatedAt: 't1',
        uploadStatus: 'uploaded',
        youtubeVideoId: 'abcdefghijk',
        uploadedToYoutubeAt: '2026-09-15T10:00:00.000Z',
      }),
    ]);
    // No act() wrapper: attempt 1 only fires after the real 4s poll interval.
    fireEvent.click(screen.getByRole('button', { name: /Retry upload/ }));
    expect(await screen.findByText(/Two steps remain in YouTube Studio/, undefined, { timeout: 8000 }))
      .toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  }, 15000);
});

/**
 * ⚠️ THE RESUME PATH HAS TO BE REACHABLE FROM A BROWSER.
 *
 * The panel used to be gated on the session-local `savedAt` flag — set only by
 * a Save in the current visit, cleared by `reset`, `onPickFile` and
 * `reopenMaster`. So every remount hid the panel, and with it `uploadSessionUri`
 * and `UPLOAD_STALE_AFTER_MS`: half the job state existed for a path nothing
 * on the page could take. The panel even told the operator to reload, which is
 * precisely what removed it.
 *
 * Gating on the ROW's persisted `savedAt` fixes the first half; re-enabling the
 * button once the row is provably stale fixes the second. Both are pinned here.
 */
describe('upload panel reachability after a remount', () => {
  const RENDERED = 'audio/mastering/1_a_song-master-14LUFS-1440p.mp4';

  /** A saved, rendered master as the STATUS ROUTE returns it — persisted state only. */
  const persisted = (over: Record<string, unknown> = {}) =>
    doneJob({
      id: 'job-9',
      savedAt: '2026-09-14T09:00:00.000Z',
      videoKey: RENDERED,
      coverKey: 'audio/mastering/1_c_cover.jpg',
      videoRenderedAt: '2026-09-14T09:30:00.000Z',
      updatedAt: '2026-09-14T09:30:00.000Z',
      uploadStatus: null,
      youtubeVideoId: null,
      uploadError: null,
      ...over,
    });

  /**
   * A remount, not a Save: the component comes up cold, re-attaches to the
   * stored job and learns everything it knows from the row. `setSavedAt` is
   * never called on this path — which is the point.
   */
  async function remountWith(job: Record<string, unknown>) {
    sessionStorage.setItem(
      'mastering-studio-job',
      JSON.stringify({ jobId: 'job-9', sourceKey: 'audio/mastering/1_a_song.wav', name: 'song.wav', size: 1024, target: -14 })
    );
    mockedFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith('/api/admin/mastering/download')) {
        return Promise.resolve(json({ success: true, url: 'https://s3/signed' }));
      }
      if (u === '/api/admin/music-lab/masters') return Promise.resolve(json({ success: true, masters: [] }));
      return Promise.resolve(json(job));
    });
    render(<MasteringStudio />);
    await screen.findByText(/3 · Result/);
  }

  it('opens the panel from the job row alone, with no Save in this session', async () => {
    await remountWith(persisted());

    // Proof the session-local flag is NOT what opened it: an unsaved-looking
    // Save button is still sitting there offering to save.
    expect(screen.getByRole('button', { name: /Save to library/ })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /Upload to YouTube/i })).toBeInTheDocument();
  });

  it('offers Retry once a queued row is older than the stale window — the resume, reachable', async () => {
    // Older than any plausible window, so no fake clock is needed. The worker's
    // own ceiling is 900s; a row this old cannot still be running.
    await remountWith(persisted({ uploadStatus: 'queued', updatedAt: '2020-01-01T00:00:00.000Z' }));
    await screen.findByRole('heading', { name: /Upload to YouTube/i });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Video title/i), { target: { value: 'ஒரு பாடல்' } });
    });

    const retry = screen.getByRole('button', { name: /Retry upload/ });
    expect(retry).toBeEnabled();
    // And it no longer tells the operator to do the thing that hides the panel.
    expect(screen.queryByText(/reload the page to pick it up/i)).not.toBeInTheDocument();
  });

  it('keeps it disabled while a queued row is still fresh — the double-click guard is untouched', async () => {
    await remountWith(persisted({ uploadStatus: 'queued', updatedAt: new Date().toISOString() }));
    await screen.findByRole('heading', { name: /Upload to YouTube/i });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Video title/i), { target: { value: 'ஒரு பாடல்' } });
    });

    expect(screen.getByRole('button', { name: /Upload to YouTube/ })).toBeDisabled();
    expect(screen.getByText(/An upload is already running for this master/)).toBeInTheDocument();
  });
});

describe('upload metadata parsing', () => {
  it('splits, trims and de-duplicates tags, and caps the list at 60', () => {
    expect(parseTagList('tamil song, , melody ,tamil song')).toEqual(['tamil song', 'melody']);
    expect(parseTagList(Array.from({ length: 70 }, (_, i) => `t${i}`).join(','))).toHaveLength(60);
  });

  it('normalises hashtags to exactly one # and no spaces', () => {
    expect(parseHashtags('#tamil song  ##two,three')).toEqual(['#tamil', '#song', '#two', '#three']);
    expect(parseHashtags('')).toEqual([]);
  });
});

/**
 * Two states the upload panel must not render dishonestly: an upload someone
 * else's mount started, and a report about a different video.
 */
describe('upload panel honesty', () => {
  const RENDERED = 'audio/mastering/1_a_song-master-14LUFS-1440p.mp4';
  const inFlight = (over: Record<string, unknown> = {}) =>
    doneJob({
      mp3Key: 'audio/mastering/1_a_song-master-14LUFS.mp3',
      videoKey: RENDERED,
      coverKey: 'audio/mastering/1_c_cover.jpg',
      updatedAt: 't0',
      youtubeVideoId: null,
      ...over,
    });

  async function openPanelWith(job: Record<string, unknown>) {
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

  it('says an upload is already running instead of showing a dead button', async () => {
    // Nothing in THIS mount is following that upload, and a second invoke is
    // what the planner's in-flight guard exists to stop — so the disabled
    // button has to explain itself.
    await openPanelWith(inFlight({ uploadStatus: 'uploading' }));
    expect(screen.getByRole('button', { name: /Upload to YouTube/ })).toBeDisabled();
    expect(screen.getByText(/An upload is already running for this master/)).toBeInTheDocument();
  });

  it('offers the plain private-draft note when no upload is running', async () => {
    await openPanelWith(inFlight({ uploadStatus: null }));
    expect(screen.queryByText(/An upload is already running/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing here makes a video public/)).toBeInTheDocument();
  });
});

/**
 * The karaoke bed — a third master target that is not a loudness target.
 *
 * The defect these guard against is the one the whole mode exists to remove: a
 * bed lands at whatever its own level puts it (-20.2 LUFS on the real Sevvanthi
 * bed), so every loudness rule on this page scored a correct file as a failed
 * -14 master — an off-target verdict, a platform table of failures, and a
 * Render video button the worker refuses.
 *
 * ⚠️ The selection is keyed by ID, not by LUFS. A bed carries -14 because the
 * route requires a target, so a lufs-keyed comparison would treat it and a -14
 * master as the same entry — and the "switching target re-arms" behaviour would
 * silently leave a finished bed on screen.
 */
describe('the karaoke bed', () => {
  const bedJob = (over: Record<string, unknown> = {}) =>
    doneJob({
      masterKey: 'audio/mastering/1_a_song-karaoke-1dBTP.wav',
      mp3Key: 'audio/mastering/1_a_song-karaoke-1dBTP.mp3',
      mp3Tp: -1.4,
      normalizationMode: 'peak',
      peakGainDb: 1.8,
      normalizationType: null,
      beforeLufs: -22, beforeTp: -2.8, beforeLra: 6.4,
      afterLufs: -20.2, afterTp: -1.0, afterLra: 6.4,
      ...over,
    });

  const pickBed = () => fireEvent.click(screen.getByRole('radio', { name: /Karaoke bed/i }));

  async function runBed(job: Record<string, unknown> = bedJob()) {
    primeHappyPath(job);
    render(<MasteringStudio />);
    await uploadA();
    pickBed();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make the karaoke bed/i })); });
    await screen.findByText(/3 · Result/);
  }

  it('is offered alongside -14 and -16', async () => {
    render(<MasteringStudio />);
    const bed = screen.getByRole('radio', { name: /Karaoke bed/i });
    expect(bed).toBeInTheDocument();
    expect(bed).toHaveAttribute('aria-checked', 'false');
    // Named by what the buyer receives, not by a number nobody aims at.
    expect(bed).toHaveTextContent(/320k MP3/);
    expect(bed).toHaveTextContent(/headroom for a live voice/i);
  });

  it('renames the run button, because it is not mastering to a target', async () => {
    render(<MasteringStudio />);
    await uploadA();
    expect(screen.getByRole('button', { name: /Master to -14 LUFS/ })).toBeInTheDocument();
    pickBed();
    expect(screen.getByRole('button', { name: /Make the karaoke bed/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Master to/ })).not.toBeInTheDocument();
  });

  it('sends normalizationMode peak, and a loudness run still sends none', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    await uploadA();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Master to -14/ })); });
    const loudnessBody = JSON.parse(
      (mockedFetch.mock.calls.find((c) => c[0] === '/api/admin/music-lab/master')![1] as { body: string }).body
    );
    expect(loudnessBody).not.toHaveProperty('normalizationMode');

    mockedFetch.mockClear();
    pickBed();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Make the karaoke bed/i })); });
    const bedBody = JSON.parse(
      (mockedFetch.mock.calls.find((c) => c[0] === '/api/admin/music-lab/master')![1] as { body: string }).body
    );
    expect(bedBody.normalizationMode).toBe('peak');
  });

  it('hides the reference picker, which the route refuses anyway', async () => {
    render(<MasteringStudio />);
    await uploadA();
    expect(screen.getByText(/Reference:/)).toBeInTheDocument();
    pickBed();
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });

  it('states what the mode does, in place of the dual-target note', async () => {
    render(<MasteringStudio />);
    pickBed();
    expect(screen.getByText(/no loudness normalisation, no compression, no limiting/i)).toBeInTheDocument();
  });

  it('reports the gain it applied rather than a target it never had', async () => {
    await runBed();
    expect(screen.getByText(/Gain applied \+1\.80 dB/)).toBeInTheDocument();
    expect(screen.queryByText(/worth a listen before you use it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Landed on -14 LUFS/)).not.toBeInTheDocument();
  });

  it('omits the streaming-platform table — nobody streams a bed', async () => {
    await runBed();
    expect(screen.queryByText(/how it lands on each platform/i)).not.toBeInTheDocument();
  });

  /** A bed is a deliverable, not a release. */
  it('hides the publish, render and short panels for a saved bed', async () => {
    await runBed();
    mockedFetch.mockResolvedValueOnce(json({ success: true, title: 'ஈழத்து மண்ணே' }));
    mockedFetch.mockResolvedValueOnce(json({ success: true, masters: [] }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save to library/ })); });
    await screen.findByRole('button', { name: /Saved to library/ });

    expect(screen.queryByRole('button', { name: /Render video/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Make a short/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/i })).not.toBeInTheDocument();
  });

  it('downloads as a karaoke bed, not as a master', async () => {
    await runBed();
    // The suffix only reaches the URL once the master is named — which is also
    // the moment the filename starts claiming what the file is.
    fireEvent.change(screen.getByLabelText(/Name this master/i), { target: { value: 'Eelathu Manne' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Download the bed/i })); });
    const req = mockedFetch.mock.calls.find((c) => String(c[0]).includes('/mastering/download'))!;
    const url = decodeURIComponent(String(req[0]));
    expect(url).toContain('(Karaoke bed -1 dBTP)');
    expect(url).not.toContain('LUFS');
  });

  /**
   * The re-arm, which is why the radio is keyed by id. A bed and a -14 master
   * share `target: -14`, so a lufs comparison would judge them the same entry
   * and leave a finished bed's result panel — verdict, downloads and all — on
   * screen while the Studio was armed to produce a streaming master.
   */
  it('clears a finished bed when -14 is chosen, despite the shared target', async () => {
    await runBed();
    expect(screen.getByText(/3 · Result/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /-14 LUFS/ }));
    await waitFor(() => expect(screen.queryByText(/3 · Result/)).not.toBeInTheDocument());
  });

  /**
   * The remount, which is why `targetId` is persisted rather than derived from
   * the stored `target`. A bed and a -14 master share -14, so without it the
   * Studio would come back armed for a streaming master and show a red
   * off-target verdict on a correct bed — the Task 5 defect through another
   * door.
   */
  it('comes back as a bed after a remount, not as a -14 master', async () => {
    sessionStorage.setItem('mastering-studio-job', JSON.stringify({
      jobId: 'job-1', sourceKey: 'audio/mastering/1_a_song.wav',
      name: 'song.wav', size: 1024, target: -14, targetId: 'karaoke',
    }));
    primeHappyPath(bedJob());
    render(<MasteringStudio />);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Karaoke bed/i })).toHaveAttribute('aria-checked', 'true')
    );
    expect(screen.getByRole('radio', { name: /-14 LUFS/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('a job stored before beds existed still comes back as its loudness target', async () => {
    sessionStorage.setItem('mastering-studio-job', JSON.stringify({
      jobId: 'job-1', sourceKey: 'audio/mastering/1_a_song.wav',
      name: 'song.wav', size: 1024, target: -16,
    }));
    primeHappyPath(doneJob({ target: -16 }));
    render(<MasteringStudio />);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /-16 LUFS/ })).toHaveAttribute('aria-checked', 'true')
    );
  });

  /**
   * Re-opening from the library arms the radio the job actually used. Derived
   * from `normalizationMode`, never from `target`, which a bed shares with -14.
   */
  it('re-opens a saved bed with the bed selected', async () => {
    primeHappyPath();
    render(<MasteringStudio />);
    mockedFetch.mockResolvedValueOnce(json({
      success: true,
      masters: [bedJob({ id: 'm1', title: 'ஈழத்து மண்ணே', savedAt: '2026-09-18T00:00:00.000Z' })],
    }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Saved masters/i })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Edit & re-master/i })); });
    expect(screen.getByRole('radio', { name: /Karaoke bed/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /-14 LUFS/ })).toHaveAttribute('aria-checked', 'false');
  });
});
