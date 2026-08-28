/**
 * Tests for <LyricCriticForm> — the admin UI for the async critique flow:
 * POST /api/admin/compose/critique returns 202 { jobId }, then the form polls
 * GET /api/admin/compose/critique/[jobId] until done. adminFetch is mocked to
 * play both halves (enqueue on POST, status on the poll GET).
 */

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

// The editor now types Tamil via react-transliterate, which hits a remote
// suggestion endpoint per word. Stub it to a plain textarea: this suite is
// about the CRITIC's behaviour, and a network call here would make it flaky.
jest.mock('react-transliterate', () => ({
  ReactTransliterate: ({ value, onChangeText, renderComponent, placeholder }: {
    value: string;
    onChangeText: (v: string) => void;
    renderComponent: (p: Record<string, unknown>) => React.ReactElement;
    placeholder?: string;
  }) => renderComponent({
    value,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChangeText(e.target.value),
  }),
}));
jest.mock('react-transliterate/dist/index.css', () => ({}), { virtual: true });

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
  // The form now writes a pre-draft safety buffer to localStorage as the
  // poet types. Clear between tests so a debounced write from a prior test
  // doesn't surface as a "restore?" banner in the next one.
  localStorage.clear();
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
  const critiqueCall = adminFetch.mock.calls.find(
    ([u, i]: [string, { method?: string }]) => u === '/api/admin/compose/critique' && i?.method === 'POST'
  );
  expect(critiqueCall).toBeTruthy();
  const [url, init] = critiqueCall!;
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
  const enqueue = adminFetch.mock.calls.find(
    ([u, i]: [string, { method?: string }]) => u === '/api/admin/compose/critique' && i?.method === 'POST'
  );
  const sent = JSON.parse(enqueue![1].body);
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

// ---- Draft management (save / load / feedback loop) ----

it('saves a new draft (POST create) and confirms the version', async () => {
  adminFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && url === '/api/admin/lyric-drafts') {
      return Promise.resolve(json(201, {
        success: true,
        draft: { id: 'draft_1', title: 'மண்வாசம்', status: 'draft', latestVersion: 1, updatedAt: 't',
          versions: [{ version: 1, lyrics: 'பல்லவி', focus: [], critique: null, createdAt: 't' }] },
      }));
    }
    return Promise.resolve(json(200, {}));
  });
  render(<LyricCriticForm />);
  fireEvent.change(screen.getByLabelText('Draft title'), { target: { value: 'மண்வாசம்' } });
  fireEvent.change(draftBox(), { target: { value: 'பல்லவி' } });
  fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

  expect(await screen.findByText('Saved v1')).toBeInTheDocument();
  const createCall = adminFetch.mock.calls.find(([u, i]: [string, { method?: string }]) => u === '/api/admin/lyric-drafts' && i?.method === 'POST');
  expect(JSON.parse(createCall[1].body)).toMatchObject({ title: 'மண்வாசம்', lyrics: 'பல்லவி' });
});

it('opens a saved draft and runs the "did I address the feedback?" loop', async () => {
  const CRIT = { overall: 'x', strengths: [], observations: [], wordIdeas: [], questions: [],
    slackLines: [{ line: 'மண்ணை தொடணும்', issue: 'too abstract' }] };
  const DRAFT = {
    id: 'draft_1', title: 'மண்', status: 'draft', latestVersion: 1, createdAt: 't', updatedAt: 't',
    versions: [{ version: 1, lyrics: 'மண்ணை தொடணும்\nகாற்று', focus: [], critique: CRIT, createdAt: 't' }],
  };
  adminFetch.mockImplementation((url: string) => {
    if (url === '/api/admin/lyric-drafts')
      return Promise.resolve(json(200, { success: true, drafts: [{ id: 'draft_1', title: 'மண்', status: 'draft', latestVersion: 1, snippet: 'மண்ணை தொடணும்', updatedAt: 't' }] }));
    if (url === '/api/admin/lyric-drafts/draft_1')
      return Promise.resolve(json(200, { success: true, draft: DRAFT }));
    return Promise.resolve(json(200, {}));
  });

  render(<LyricCriticForm />);
  fireEvent.click(screen.getByRole('button', { name: /saved drafts/i }));      // lazy-load list
  fireEvent.click(await screen.findByRole('button', { name: /மண்/ }));          // open the draft

  // Slack line is still present verbatim → 0 of 1 addressed.
  expect(await screen.findByText(/reworked 0 of 1 flagged line/i)).toBeInTheDocument();

  // Rework the flagged line away → loop updates to all-addressed.
  fireEvent.change(draftBox(), { target: { value: 'மண்ணின் வாசம்\nகாற்று' } });
  expect(await screen.findByText(/reworked 1 of 1 flagged line/i)).toBeInTheDocument();
  expect(screen.getByText(/all addressed/i)).toBeInTheDocument();
});

it('adds a suggested word idea to the lexicon in one click', async () => {
  adminFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === 'POST' && url === '/api/admin/compose/critique')
      return Promise.resolve(json(202, { success: true, jobId: 'critic_1' }));
    if (url.startsWith('/api/admin/compose/critique/'))
      return Promise.resolve(json(200, { success: true, status: 'done', result: CRITIQUE }));
    if (init?.method === 'POST' && url === '/api/admin/lexicon')
      return Promise.resolve(json(201, { success: true }));
    return Promise.resolve(json(200, {}));
  });
  render(<LyricCriticForm />);
  fireEvent.change(draftBox(), { target: { value: 'ஊருக்குப் போகணும்' } });
  fireEvent.click(screen.getByRole('button', { name: /critique my draft/i }));

  const addBtn = await screen.findByRole('button', { name: /add எழில் to your lexicon/i });
  fireEvent.click(addBtn);

  await waitFor(() =>
    expect(adminFetch.mock.calls.some(([u, i]: [string, { method?: string }]) => u === '/api/admin/lexicon' && i?.method === 'POST')).toBe(true)
  );
  const lexCall = adminFetch.mock.calls.find(([u, i]: [string, { method?: string }]) => u === '/api/admin/lexicon' && i?.method === 'POST');
  expect(JSON.parse(lexCall[1].body)).toMatchObject({ word: 'எழில்', register: 'literary' });
  // The control flips to the "already in lexicon" state.
  expect(await screen.findByRole('button', { name: /எழில் is in your lexicon/i })).toBeInTheDocument();
});

describe('pre-draft buffer', () => {
  it('offers to restore unsaved text from a previous session on mount', async () => {
    localStorage.setItem(
      'lyric-critic:pre-draft',
      JSON.stringify({ lyrics: 'கண்ணே\nஉன்னைக் காண', title: 'கண்ணே', updatedAt: Date.now() })
    );
    render(<LyricCriticForm />);
    const banner = await screen.findByTestId('pre-draft-restore');
    expect(banner).toHaveTextContent(/unsaved text from your last session/i);
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }));
    // Lyrics have been populated from the buffer.
    expect((draftBox() as HTMLTextAreaElement).value).toBe('கண்ணே\nஉன்னைக் காண');
    // Banner is dismissed after restore.
    expect(screen.queryByTestId('pre-draft-restore')).not.toBeInTheDocument();
  });

  it('does not offer to restore when nothing is in the buffer', () => {
    render(<LyricCriticForm />);
    expect(screen.queryByTestId('pre-draft-restore')).not.toBeInTheDocument();
  });

  it('"Start fresh" dismisses the banner and clears the buffer', () => {
    localStorage.setItem(
      'lyric-critic:pre-draft',
      JSON.stringify({ lyrics: 'text', title: '', updatedAt: Date.now() })
    );
    render(<LyricCriticForm />);
    fireEvent.click(screen.getByRole('button', { name: /start fresh/i }));
    expect(screen.queryByTestId('pre-draft-restore')).not.toBeInTheDocument();
    expect(localStorage.getItem('lyric-critic:pre-draft')).toBeNull();
  });
});
