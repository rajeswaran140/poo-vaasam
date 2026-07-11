/**
 * Tests for <LyricGeneratorForm> — the admin UI for POST /api/admin/compose/lyrics.
 * TamilInput is mocked to a plain input (it has its own tests); we drive the
 * form's validation, the brief payload it POSTs, result rendering, and errors.
 */

// TamilInput → a plain input keyed by its label/placeholder so tests can drive it.
jest.mock('@/components/admin/TamilInput', () => ({
  TamilInput: ({ label, placeholder, value, onChange }: { label?: string; placeholder?: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label || placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LyricGeneratorForm } from '@/components/admin/LyricGeneratorForm';

const LYRICS = {
  title: 'ஊர் ஏக்கம்', // distinct from every lyric line so findByText is unambiguous
  pallavi: ['ஊருக்குப் போகணும்', 'மண்ணை தொடணும்'],
  anupallavi: [],
  charanams: [['வயல் வரப்பினில்', 'நடந்து போகணும்']],
  notes: '',
};

const jsonResponse = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  adminFetch.mockReset();
  adminFetch.mockResolvedValue(jsonResponse(200, { success: true, data: LYRICS }));
});

function fillBrief() {
  fireEvent.change(screen.getByPlaceholderText(/Homeland nostalgia/i), { target: { value: 'Homeland nostalgia' } });
  fireEvent.change(screen.getByPlaceholderText(/Dominant emotion/i), { target: { value: 'ஏக்கம்' } });
}

it('disables Generate until a theme and an emotion are provided', () => {
  render(<LyricGeneratorForm />);
  expect(screen.getByRole('button', { name: /generate lyrics/i })).toBeDisabled();
  fillBrief();
  expect(screen.getByRole('button', { name: /generate lyrics/i })).toBeEnabled();
});

it('POSTs the brief and renders the returned lyric', async () => {
  render(<LyricGeneratorForm />);
  fillBrief();
  fireEvent.click(screen.getByRole('button', { name: /generate lyrics/i }));

  await waitFor(() => expect(adminFetch).toHaveBeenCalledTimes(1));
  const [url, init] = adminFetch.mock.calls[0];
  expect(url).toBe('/api/admin/compose/lyrics');
  expect(init.method).toBe('POST');
  const sent = JSON.parse(init.body);
  expect(sent).toMatchObject({
    theme: 'Homeland nostalgia',
    emotions: ['ஏக்கம்'],
    register: 'modern',
    structure: { anupallavi: false, charanams: 2 },
  });

  expect(await screen.findByText('ஊர் ஏக்கம்')).toBeInTheDocument();
  expect(screen.getByText('ஊருக்குப் போகணும்')).toBeInTheDocument(); // pallavi line
  expect(screen.getByText('வயல் வரப்பினில்')).toBeInTheDocument(); // charanam line
});

it('shows the API error message on failure', async () => {
  adminFetch.mockResolvedValueOnce(jsonResponse(502, { success: false, error: 'The AI service failed to respond.' }));
  render(<LyricGeneratorForm />);
  fillBrief();
  fireEvent.click(screen.getByRole('button', { name: /generate lyrics/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/AI service failed to respond/i);
});

it('omits empty optional fields from the payload but trims and includes seed words', async () => {
  render(<LyricGeneratorForm />);
  fillBrief();
  fireEvent.change(screen.getByPlaceholderText(/மண்வாசம்/), { target: { value: ' மண்வாசம் , வயல் ' } });
  fireEvent.click(screen.getByRole('button', { name: /generate lyrics/i }));
  await waitFor(() => expect(adminFetch).toHaveBeenCalledTimes(1));
  const sent = JSON.parse(adminFetch.mock.calls[0][1].body);
  expect(sent.seedWords).toEqual(['மண்வாசம்', 'வயல்']);
  expect(sent).not.toHaveProperty('voice');
  expect(sent).not.toHaveProperty('titleHint');
  expect(sent).not.toHaveProperty('notes');
});

it('drops a stale result when the brief is edited while a generation is in flight', async () => {
  let resolveFetch: (v: unknown) => void = () => {};
  adminFetch.mockReturnValueOnce(new Promise((res) => { resolveFetch = res; }));

  render(<LyricGeneratorForm />);
  fillBrief();
  fireEvent.click(screen.getByRole('button', { name: /generate/i }));
  await waitFor(() => expect(adminFetch).toHaveBeenCalledTimes(1));

  // Edit the brief while the request is still pending → invalidates it.
  fireEvent.change(screen.getByPlaceholderText(/Homeland nostalgia/i), { target: { value: 'A different theme' } });

  // The in-flight request now resolves with the PRE-edit brief's lyric.
  await act(async () => {
    resolveFetch(jsonResponse(200, { success: true, data: LYRICS }));
  });
  await waitFor(() => expect(screen.getByRole('button', { name: /generate lyrics/i })).toBeEnabled());

  // The stale result must not be rendered against the changed brief.
  expect(screen.queryByText('ஊர் ஏக்கம்')).not.toBeInTheDocument();
});

it('flags when the model returns fewer charanams than the brief requested', async () => {
  // Default mock returns LYRICS (1 charanam); request 3.
  render(<LyricGeneratorForm />);
  fillBrief();
  fireEvent.change(screen.getByLabelText('Charanams'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: /generate lyrics/i }));

  expect(await screen.findByText('ஊர் ஏக்கம்')).toBeInTheDocument();
  expect(screen.getByText(/returned 1 of 3 charanams/i)).toBeInTheDocument();
});

it('shows no shortfall note when the charanam count matches the request', async () => {
  adminFetch.mockResolvedValueOnce(jsonResponse(200, { success: true, data: { ...LYRICS, charanams: [['ஒன்று'], ['இரண்டு']] } }));
  render(<LyricGeneratorForm />);
  fillBrief(); // default request = 2 charanams
  fireEvent.click(screen.getByRole('button', { name: /generate lyrics/i }));

  expect(await screen.findByText('ஊர் ஏக்கம்')).toBeInTheDocument();
  expect(screen.queryByText(/returned .* charanams/i)).not.toBeInTheDocument();
});
