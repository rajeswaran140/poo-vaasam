/** @jest-environment jsdom */
/**
 * Tests for ComposerForm — async compose flow (enqueue + poll), form submit
 * (Cmd+Enter + button), maxLength cap, warn-state counter, regenerate, error
 * doesn't wipe previous result, grounded-ragas card, Save brief, abort signal.
 *
 * Compose now POSTs /api/admin/compose (→ jobId) then polls
 * GET /api/admin/compose/[jobId] until done/error. Each successful compose is
 * therefore TWO adminFetch calls; `queueCompose()` queues both.
 */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('lucide-react', () => ({
  Copy: () => <svg data-testid="icon-copy" />,
  Check: () => <svg data-testid="icon-check" />,
  Sparkles: () => <svg data-testid="icon-sparkles" />,
  RotateCw: () => <svg data-testid="icon-rotate" />,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComposerForm } from '@/components/admin/ComposerForm';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const SAMPLE = {
  emotion: 'காதல்',
  emotion_breakdown: ['காதல்'], // length 1 → breakdown card hidden, so the 'காதல்' stat stays unique
  mood: 'Tender',
  theme: 'Love',
  suggested_key: 'D Minor',
  suggested_bpm: 72,
  suggested_instruments: ['Veena', 'Flute'],
  suggested_ragas: ['Keeravani', 'Sahana'],
  recommended_voice: ['Male Baritone', 'Female Adult'],
  song_titles: ['இரவின் அன்பு', 'நிலவின் நிழல்', 'மழை'],
  suno_prompts: [{ style: 'Traditional Tamil', prompt: 'Slow Tamil ballad in D minor at 72 BPM…' }],
  thumbnail_prompt: 'A cinematic Tamil scene at golden hour.',
  youtube_description_tamil: 'ஒரு மென்மையான பாடல்.',
  youtube_description_english: 'A tender Tamil love song.\n\n#tamilsong',
  reel: { hook: 'ஒரு வரி', caption: 'A love song', hashtags: ['#tamil'] },
};

let jobSeq = 0;
const enqueued = () =>
  ({ ok: true, status: 202, json: async () => ({ success: true, jobId: `job_${++jobSeq}`, status: 'processing' }) } as unknown as Response);
const statusDone = (result: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, status: 'done', result }) } as unknown as Response);
const statusErr = (error: { code?: string; message?: string }) =>
  ({ ok: true, status: 200, json: async () => ({ success: true, status: 'error', error }) } as unknown as Response);
const fail = (s: number, b: unknown) => ({ ok: false, status: s, json: async () => b } as unknown as Response);
const okJson = (b: unknown) => ({ ok: true, status: 201, json: async () => b } as unknown as Response);

// Queue a full successful compose: POST enqueue, then the first poll returns done.
const queueCompose = (result: unknown) => {
  mockedFetch.mockResolvedValueOnce(enqueued()).mockResolvedValueOnce(statusDone(result));
};

beforeEach(() => {
  mockedFetch.mockReset();
  jobSeq = 0;
});

it('renders the form, textarea, and a disabled submit button when empty', () => {
  render(<ComposerForm />);
  expect(screen.getByLabelText('Tamil lyrics')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /compose brief/i })).toBeDisabled();
});

it('enforces maxLength on the textarea (8000 cap)', () => {
  render(<ComposerForm />);
  const textarea = screen.getByLabelText('Tamil lyrics') as HTMLTextAreaElement;
  expect(textarea).toHaveAttribute('maxLength', '8000');
});

it('counter turns amber at 7500 and red at 8000', () => {
  render(<ComposerForm />);
  const textarea = screen.getByLabelText('Tamil lyrics') as HTMLTextAreaElement;

  fireEvent.change(textarea, { target: { value: 'x'.repeat(100) } });
  expect(screen.getByText(/100 \/ 8,000/).className).toMatch(/gray-500/);

  fireEvent.change(textarea, { target: { value: 'x'.repeat(7600) } });
  expect(screen.getByText(/7,600 \/ 8,000/).className).toMatch(/amber/);

  fireEvent.change(textarea, { target: { value: 'x'.repeat(8000) } });
  expect(screen.getByText(/8,000 \/ 8,000/).className).toMatch(/red/);
});

it('enqueues a compose and shows the polled result', async () => {
  queueCompose(SAMPLE);
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'காதல் வரிகள்' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));

  // First call is the enqueue POST with the lyrics body.
  await waitFor(() => expect(mockedFetch.mock.calls[0]?.[0]).toBe('/api/admin/compose'));
  expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({ lyrics: 'காதல் வரிகள்' });
  // Second call polls the job status.
  await waitFor(() => expect(String(mockedFetch.mock.calls[1]?.[0])).toMatch(/^\/api\/admin\/compose\/job_/));

  await waitFor(() => expect(screen.getByTestId('composer-results')).toBeInTheDocument());
  expect(screen.getByTestId('composer-results').getAttribute('aria-live')).toBe('polite');
  expect(screen.getByText('காதல்')).toBeInTheDocument();
  expect(screen.getByText('72')).toBeInTheDocument();
  expect(screen.getByText('Suggested ragas (ranked)')).toBeInTheDocument();
  expect(screen.getByText('Keeravani')).toBeInTheDocument();
});

it('Cmd+Enter on the textarea submits the form', async () => {
  queueCompose(SAMPLE);
  render(<ComposerForm />);

  const textarea = screen.getByLabelText('Tamil lyrics');
  fireEvent.change(textarea, { target: { value: 'lyrics' } });
  fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/admin/compose', expect.anything()));
});

it('plain Enter does NOT submit', () => {
  render(<ComposerForm />);
  const textarea = screen.getByLabelText('Tamil lyrics');
  fireEvent.change(textarea, { target: { value: 'lyrics' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(mockedFetch).not.toHaveBeenCalled();
});

it('Regenerate re-fires the request and shows the new brief', async () => {
  queueCompose(SAMPLE);
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByTestId('composer-results')).toBeInTheDocument());

  queueCompose({ ...SAMPLE, emotion: 'அன்னை' });
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

  await waitFor(() => expect(screen.getByText('அன்னை')).toBeInTheDocument());
});

it('keeps the previous result when a subsequent compose fails (shows error inline)', async () => {
  queueCompose(SAMPLE);
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByText('காதல்')).toBeInTheDocument());

  // Second attempt: the enqueue POST itself fails.
  mockedFetch.mockResolvedValueOnce(fail(502, { success: false, error: 'enqueue borked' }));
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('enqueue borked'));
  expect(screen.getByText('காதல்')).toBeInTheDocument(); // previous result still visible
});

it('surfaces a worker error from the status poll', async () => {
  mockedFetch.mockResolvedValueOnce(enqueued()).mockResolvedValueOnce(statusErr({ code: 'rate_limit', message: 'rate limited, retry' }));
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/rate limited/i));
  expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument(); // rate_limit is retryable
});

it('hides Retry for a non-retryable (auth) job error but still shows it', async () => {
  mockedFetch.mockResolvedValueOnce(enqueued()).mockResolvedValueOnce(statusErr({ code: 'auth', message: 'The Claude API key is invalid.' }));
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/key is invalid/i));
  expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
});

it('saves the brief (POST /api/admin/briefs) with the chosen SUNO style, and shows Saved', async () => {
  queueCompose(SAMPLE);
  render(<ComposerForm />);
  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'அரிதான' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /save brief/i })).toBeInTheDocument());

  mockedFetch.mockResolvedValueOnce(okJson({ success: true, data: { id: 'brief_1' } }));
  fireEvent.click(screen.getByRole('button', { name: /save brief/i }));

  await waitFor(() => expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument());
  const saveCall = mockedFetch.mock.calls.find((c) => c[0] === '/api/admin/briefs');
  expect(saveCall).toBeTruthy();
  const sent = JSON.parse(saveCall![1].body);
  expect(sent.lyrics).toBe('அரிதான');
  expect(sent.analysis.emotion).toBe('காதல்');
  expect(sent.decision.chosenSunoStyle).toBe('Traditional Tamil');
});

// Regression: after Save then Regenerate, <SaveBrief> must reset.
it('re-enables Save and refreshes the chosen style after Regenerate (no stuck "Saved ✓")', async () => {
  queueCompose(SAMPLE);
  render(<ComposerForm />);
  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics A' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /save brief/i })).toBeInTheDocument());

  mockedFetch.mockResolvedValueOnce(okJson({ success: true, data: { id: 'b1' } }));
  fireEvent.click(screen.getByRole('button', { name: /save brief/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument());

  queueCompose({ ...SAMPLE, emotion: 'அன்னை', suno_prompts: [{ style: 'Village folk', prompt: 'Folk in G…' }] });
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  await waitFor(() => expect(screen.getByText('அன்னை')).toBeInTheDocument());

  expect(await screen.findByRole('button', { name: /save brief/i })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /saved/i })).not.toBeInTheDocument();
  expect((screen.getByLabelText('Chosen SUNO style') as HTMLSelectElement).value).toBe('Village folk');
});

it('passes an AbortSignal to the compose request (cancellable on unmount)', async () => {
  queueCompose(SAMPLE);
  render(<ComposerForm />);
  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));

  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  expect(mockedFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
});
