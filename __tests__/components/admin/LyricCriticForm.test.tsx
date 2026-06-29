/**
 * Tests for <LyricCriticForm> — the admin UI for the async critique flow:
 * POST /api/admin/compose/critique returns 202 { jobId }, then the form polls
 * GET /api/admin/compose/critique/[jobId] until done. adminFetch is mocked to
 * play both halves (enqueue on POST, status on the poll GET).
 */

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

const writeText = jest.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LyricCriticForm } from '@/components/admin/LyricCriticForm';

const CRITIQUE = {
  overall: 'A tender opening that the second half does not fully earn.',
  strengths: ['The மண்வாசம் image lands concretely'],
  observations: [{ aspect: 'meter', note: 'Line three runs a beat long' }],
  slackLines: [{ line: 'மண்ணை தொடணும்', issue: 'abstract beside concrete neighbours' }],
  wordIdeas: [{ instead_of: 'அழகு', consider: ['எழில்'], why: 'less generic' }],
  questions: ['Whose voice carries the charanam?'],
};

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// Default: POST enqueues (202 + jobId); the poll GET returns done + the critique.
function wireHappyPath() {
  adminFetch.mockImplementation((_url: string, init?: { method?: string }) =>
    Promise.resolve(
      init?.method === 'POST'
        ? json(202, { success: true, jobId: 'critic_1', status: 'processing' })
        : json(200, { success: true, status: 'done', result: CRITIQUE })
    )
  );
}

beforeEach(() => {
  adminFetch.mockReset();
  writeText.mockClear();
  wireHappyPath();
});

const draftBox = () => screen.getByPlaceholderText(/உங்கள் சொந்த/);

it('copies the critique as Markdown', async () => {
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));
  await screen.findByText(/tender opening/i); // critique rendered

  fireEvent.click(screen.getByRole('button', { name: /copy markdown/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  const md = writeText.mock.calls[0][0] as string;
  expect(md).toContain('# Lyric Critic — feedback');
  expect(md).toContain('tender opening'); // overall
  expect(md).toContain('மண்ணை தொடணும்'); // slack line, verbatim
  expect(await screen.findByText('Copied')).toBeInTheDocument(); // button confirms (after async write)
});

it('disables "Critique my draft" until a draft is entered', () => {
  render(<LyricCriticForm />);
  expect(screen.getByRole('button', { name: /critique my draft/i })).toBeDisabled();
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  expect(screen.getByRole('button', { name: /critique my draft/i })).toBeEnabled();
});

it('enqueues, polls, and renders the critique sections', async () => {
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: '  ஊருக்குப் போகணும்  ' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));

  // First call is the POST enqueue with the trimmed draft.
  await waitFor(() => expect(adminFetch).toHaveBeenCalled());
  const [url, init] = adminFetch.mock.calls[0];
  expect(url).toBe('/api/admin/compose/critique');
  expect(init.method).toBe('POST');
  expect(JSON.parse(init.body).lyrics).toBe('ஊருக்குப் போகணும்');

  // Then it polls the job and renders the result.
  expect(await screen.findByText(/tender opening/i)).toBeInTheDocument();
  expect(screen.getByText('மண்ணை தொடணும்')).toBeInTheDocument(); // slack line, verbatim
  expect(screen.getByText('Whose voice carries the charanam?')).toBeInTheDocument();
  await waitFor(() => expect(adminFetch.mock.calls.some(([u]) => String(u).includes('/critique/critic_1'))).toBe(true));
});

it('includes toggled focus aspects and notes in the enqueue payload', async () => {
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: 'meter' }));
  fireEvent.click(screen.getByRole('button', { name: 'imagery' }));
  fireEvent.change(screen.getByPlaceholderText(/Does the charanam/i), { target: { value: 'Is the ache sustained?' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));

  await waitFor(() => expect(adminFetch).toHaveBeenCalled());
  const sent = JSON.parse(adminFetch.mock.calls[0][1].body);
  expect(sent.focus).toEqual(['meter', 'imagery']);
  expect(sent.notes).toBe('Is the ache sustained?');
});

it('shows the error when the job comes back failed', async () => {
  adminFetch.mockImplementation((_url: string, init?: { method?: string }) =>
    Promise.resolve(
      init?.method === 'POST'
        ? json(202, { success: true, jobId: 'critic_1' })
        : json(200, { success: true, status: 'error', error: { code: 'bad_response', message: 'The AI returned an incomplete critique.' } })
    )
  );
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/incomplete critique/i);
});

it('shows the error when the enqueue itself is rejected', async () => {
  adminFetch.mockResolvedValueOnce(json(502, { success: false, error: 'Could not start the critique job.' }));
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not start/i);
});
