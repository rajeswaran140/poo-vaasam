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
import { MasteringStudio } from '@/components/admin/MasteringStudio';
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
