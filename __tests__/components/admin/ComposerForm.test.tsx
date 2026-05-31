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
  mood: 'Tender',
  theme: 'Love',
  suggested_key: 'D Minor',
  suggested_bpm: 72,
  suggested_instruments: ['Veena', 'Flute'],
  song_titles: ['இரவின் அன்பு', 'நிலவின் நிழல்', 'காதல் மழை'],
  suno_prompt: 'Slow Tamil ballad in D minor at 72 BPM…',
  youtube_description: 'A tender Tamil love song.\n\n#tamilsong',
};
const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as unknown as Response);
const fail = (s: number, b: unknown) => ({ ok: false, status: s, json: async () => b } as unknown as Response);

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
