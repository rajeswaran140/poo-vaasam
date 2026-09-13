/** @jest-environment jsdom */
/**
 * Bulk WAV upload.
 *
 * Every uploader in the admin was single-file, so putting ten Suno stems into
 * the workspace meant ten trips through the Sound Engineering drop zone. This
 * takes a whole batch, but uploads each file through the SAME presigned route
 * one at a time — no archive is ever sent, so nothing extracts untrusted input
 * server-side.
 *
 * The properties worth pinning are the ones a batch introduces and a single
 * upload never had: one bad file must not sink the batch, and a failure must
 * stay visible and retryable rather than vanishing.
 */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { BulkWavUpload } from '@/components/admin/BulkWavUpload';

const mockedFetch = adminFetch as jest.Mock;
const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

const presign = (key: string) =>
  json({ success: true, uploadUrl: 'https://s3/u', fields: { key: 'k' }, key });

class FakeXHR {
  status = 204;
  responseText = '';
  upload = { onprogress: null as null | ((e: unknown) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  open() {}
  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1024, total: 1024 });
    this.onload?.();
  }
  abort() { this.onabort?.(); }
}

const wav = (name: string) => new File(['x'], name, { type: 'audio/wav' });

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
});

function drop(files: File[]) {
  const input = screen.getByLabelText(/Choose WAV files/i) as HTMLInputElement;
  return act(async () => { fireEvent.change(input, { target: { files } }); });
}

it('accepts more than one file at a time', () => {
  render(<BulkWavUpload />);
  const input = screen.getByLabelText(/Choose WAV files/i) as HTMLInputElement;
  expect(input.multiple).toBe(true);
});

it('uploads every file in the batch and names each one', async () => {
  render(<BulkWavUpload />);
  mockedFetch
    .mockResolvedValueOnce(presign('audio/mastering/1_a_vocals.wav'))
    .mockResolvedValueOnce(presign('audio/mastering/1_b_drums.wav'))
    .mockResolvedValueOnce(presign('audio/mastering/1_c_bass.wav'));

  await drop([wav('vocals.wav'), wav('drums.wav'), wav('bass.wav')]);

  await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(3));
  expect(screen.getByText('vocals.wav')).toBeInTheDocument();
  expect(screen.getByText('drums.wav')).toBeInTheDocument();
  expect(screen.getByText('bass.wav')).toBeInTheDocument();
  expect(mockedFetch).toHaveBeenCalledTimes(3);
});

it('rejects a non-WAV before presigning it, and says why', async () => {
  render(<BulkWavUpload />);
  await drop([new File(['x'], 'notes.mp3', { type: 'audio/mpeg' })]);

  expect(await screen.findByText(/not a WAV/i)).toBeInTheDocument();
  // Never reached the server — the point of a client-side guard.
  expect(mockedFetch).not.toHaveBeenCalled();
});

it('one failure does not sink the rest of the batch', async () => {
  render(<BulkWavUpload />);
  mockedFetch
    .mockResolvedValueOnce(presign('audio/mastering/1_a_ok1.wav'))
    .mockResolvedValueOnce(json({ success: false, error: 'File too large.' }, 413))
    .mockResolvedValueOnce(presign('audio/mastering/1_c_ok2.wav'));

  await drop([wav('ok1.wav'), wav('toobig.wav'), wav('ok2.wav')]);

  await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2));
  expect(screen.getByText(/File too large/i)).toBeInTheDocument();
});

it('offers a retry on the file that failed, and only that file', async () => {
  render(<BulkWavUpload />);
  mockedFetch
    .mockResolvedValueOnce(presign('audio/mastering/1_a_ok1.wav'))
    .mockResolvedValueOnce(json({ success: false, error: 'Network hiccup' }, 500));

  await drop([wav('ok1.wav'), wav('flaky.wav')]);
  await waitFor(() => expect(screen.getByText(/Network hiccup/i)).toBeInTheDocument());

  const retries = screen.getAllByRole('button', { name: /Retry/i });
  expect(retries).toHaveLength(1);

  mockedFetch.mockResolvedValueOnce(presign('audio/mastering/1_b_flaky.wav'));
  await act(async () => { fireEvent.click(retries[0]); });

  await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2));
  expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
});
