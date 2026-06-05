/** @jest-environment jsdom */
/**
 * Tests for ComposerForm — covers the audit fix bundle: form submit
 * (Cmd+Enter + button), maxLength cap, warn-state char counter,
 * regenerate button, error doesn't wipe previous result, aria-live
 * results region.
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
  emotion_breakdown: ['காதல்'], // length 1 → breakdown card hidden, so the 'காதல்' stat stays unique for assertions
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
// Success is read as a stream/text by the client (heartbeat-streamed route);
// errors come back as a normal non-ok JSON response.
const ok = (b: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) } as unknown as Response);
const fail = (s: number, b: unknown) => ({ ok: false, status: s, json: async () => b } as unknown as Response);
// The Save-brief call reads res.json() (normal JSON, not the compose stream).
const okJson = (b: unknown) => ({ ok: true, status: 201, json: async () => b } as unknown as Response);

beforeEach(() => mockedFetch.mockReset());

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

it('submits via the button and shows the structured result', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: SAMPLE }));
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'காதல் வரிகள்' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
  const [url, init] = mockedFetch.mock.calls[0];
  expect(url).toBe('/api/admin/compose');
  expect(JSON.parse(init.body)).toEqual({ lyrics: 'காதல் வரிகள்' });

  await waitFor(() => expect(screen.getByTestId('composer-results')).toBeInTheDocument());
  expect(screen.getByTestId('composer-results').getAttribute('aria-live')).toBe('polite');
  expect(screen.getByText('காதல்')).toBeInTheDocument();
  expect(screen.getByText('72')).toBeInTheDocument();
  // Grounded ragas render in their own ranked card.
  expect(screen.getByText('Suggested ragas (ranked)')).toBeInTheDocument();
  expect(screen.getByText('Keeravani')).toBeInTheDocument();
});

it('Cmd+Enter on the textarea submits the form', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: SAMPLE }));
  render(<ComposerForm />);

  const textarea = screen.getByLabelText('Tamil lyrics');
  fireEvent.change(textarea, { target: { value: 'lyrics' } });
  fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
});

it('plain Enter does NOT submit', () => {
  render(<ComposerForm />);
  const textarea = screen.getByLabelText('Tamil lyrics');
  fireEvent.change(textarea, { target: { value: 'lyrics' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(mockedFetch).not.toHaveBeenCalled();
});

it('shows a Regenerate button beside the result that re-fires the request', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: SAMPLE }));
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByTestId('composer-results')).toBeInTheDocument());

  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: { ...SAMPLE, emotion: 'அன்னை' } }));
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText('அன்னை')).toBeInTheDocument());
});

it('keeps the previous result when a subsequent compose fails (shows error inline)', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: SAMPLE }));
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByText('காதல்')).toBeInTheDocument());

  // Second attempt fails.
  mockedFetch.mockResolvedValueOnce(fail(502, { success: false, error: 'upstream borked' }));
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('upstream borked'));
  // Previous result still visible.
  expect(screen.getByText('காதல்')).toBeInTheDocument();
});

it('error banner exposes its own Retry button', async () => {
  mockedFetch.mockResolvedValueOnce(fail(502, { success: false, error: 'boom' }));
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

  expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
});

it('hides Retry for a non-retryable (auth) failure but still shows the error', async () => {
  // Streamed failure carrying code:'auth' — retrying would just fail again.
  mockedFetch.mockResolvedValueOnce(
    ok({ success: false, error: 'The Claude API key is invalid.', code: 'auth' })
  );
  render(<ComposerForm />);

  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/key is invalid/i));
  expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
});

it('saves the brief (POST /api/admin/briefs) with the chosen SUNO style, and shows Saved', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: SAMPLE })); // compose
  render(<ComposerForm />);
  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'அரிதான' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /save brief/i })).toBeInTheDocument());

  mockedFetch.mockResolvedValueOnce(okJson({ success: true, data: { id: 'brief_1' } })); // save
  fireEvent.click(screen.getByRole('button', { name: /save brief/i }));

  await waitFor(() => expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument());
  const saveCall = mockedFetch.mock.calls.find((c) => c[0] === '/api/admin/briefs');
  expect(saveCall).toBeTruthy();
  const sent = JSON.parse(saveCall![1].body);
  expect(sent.lyrics).toBe('அரிதான');
  expect(sent.analysis.emotion).toBe('காதல்');
  expect(sent.decision.chosenSunoStyle).toBe('Traditional Tamil'); // SAMPLE's only style
});

// Regression: after Save then Regenerate, <SaveBrief> must reset — otherwise it
// stays stuck on "Saved ✓" (new brief unsavable) with a stale style dropdown.
it('re-enables Save and refreshes the chosen style after Regenerate (no stuck "Saved ✓")', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: SAMPLE })); // compose A
  render(<ComposerForm />);
  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics A' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /save brief/i })).toBeInTheDocument());

  // Save brief A → "Saved ✓"
  mockedFetch.mockResolvedValueOnce(okJson({ success: true, data: { id: 'b1' } }));
  fireEvent.click(screen.getByRole('button', { name: /save brief/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /saved/i })).toBeInTheDocument());

  // Regenerate → brief B with a DIFFERENT SUNO style
  mockedFetch.mockResolvedValueOnce(ok({
    success: true,
    data: { ...SAMPLE, emotion: 'அன்னை', suno_prompts: [{ style: 'Village folk', prompt: 'Folk in G…' }] },
  }));
  fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
  await waitFor(() => expect(screen.getByText('அன்னை')).toBeInTheDocument());

  // Save is actionable again, not locked on "Saved ✓"…
  expect(await screen.findByRole('button', { name: /save brief/i })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /saved/i })).not.toBeInTheDocument();
  // …and the dropdown reflects brief B's style, not A's stale one.
  expect((screen.getByLabelText('Chosen SUNO style') as HTMLSelectElement).value).toBe('Village folk');
});

it('passes an AbortSignal to the compose request (so it can be cancelled on unmount)', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true, data: SAMPLE }));
  render(<ComposerForm />);
  fireEvent.change(screen.getByLabelText('Tamil lyrics'), { target: { value: 'lyrics' } });
  fireEvent.click(screen.getByRole('button', { name: /compose brief/i }));

  await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
  const init = mockedFetch.mock.calls[0][1];
  expect(init.signal).toBeInstanceOf(AbortSignal);
});
