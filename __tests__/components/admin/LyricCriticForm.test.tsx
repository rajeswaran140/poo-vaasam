/**
 * Tests for <LyricCriticForm> — the admin UI for POST /api/admin/compose/critique.
 * We drive the draft textarea, focus chips, the payload it POSTs, the rendered
 * critique sections, and the error path. adminFetch is mocked.
 */

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

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

const jsonResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  adminFetch.mockReset();
  adminFetch.mockResolvedValue(jsonResponse(200, { success: true, data: CRITIQUE }));
});

const draftBox = () => screen.getByPlaceholderText(/உங்கள் சொந்த/);

it('disables "Critique my draft" until a draft is entered', () => {
  render(<LyricCriticForm />);
  expect(screen.getByRole('button', { name: /critique my draft/i })).toBeDisabled();
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  expect(screen.getByRole('button', { name: /critique my draft/i })).toBeEnabled();
});

it('POSTs the draft and renders the critique sections', async () => {
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: '  ஊருக்குப் போகணும்  ' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));

  await waitFor(() => expect(adminFetch).toHaveBeenCalledTimes(1));
  const [url, init] = adminFetch.mock.calls[0];
  expect(url).toBe('/api/admin/compose/critique');
  expect(init.method).toBe('POST');
  const sent = JSON.parse(init.body);
  expect(sent.lyrics).toBe('ஊருக்குப் போகணும்'); // trimmed
  expect(sent.focus).toEqual([]);
  expect(sent).not.toHaveProperty('notes');

  expect(await screen.findByText(/tender opening/i)).toBeInTheDocument();
  expect(screen.getByText('The மண்வாசம் image lands concretely')).toBeInTheDocument(); // strength
  expect(screen.getByText('Line three runs a beat long')).toBeInTheDocument(); // observation
  expect(screen.getByText('மண்ணை தொடணும்')).toBeInTheDocument(); // slack line, quoted verbatim
  expect(screen.getByText('Whose voice carries the charanam?')).toBeInTheDocument(); // question
});

it('includes toggled focus aspects and notes in the payload', async () => {
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: 'meter' }));
  fireEvent.click(screen.getByRole('button', { name: 'imagery' }));
  fireEvent.change(screen.getByPlaceholderText(/Does the charanam/i), { target: { value: 'Is the ache sustained?' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));

  await waitFor(() => expect(adminFetch).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(adminFetch.mock.calls[0][1].body);
  expect(sent.focus).toEqual(['meter', 'imagery']);
  expect(sent.notes).toBe('Is the ache sustained?');
});

it('toggling a focus chip off removes it again', async () => {
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: 'meter' }));
  fireEvent.click(screen.getByRole('button', { name: 'meter' })); // off again
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));
  await waitFor(() => expect(adminFetch).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(adminFetch.mock.calls[0][1].body);
  expect(sent.focus).toEqual([]);
});

it('shows the API error message on failure', async () => {
  adminFetch.mockResolvedValueOnce(jsonResponse(502, { success: false, error: 'The AI service failed to respond.' }));
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/AI service failed to respond/i);
});
