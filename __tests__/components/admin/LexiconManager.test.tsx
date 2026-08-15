import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LexiconManager, type LexiconRow } from '@/components/admin/LexiconManager';

// Our transliteration proxy shape for "amma".
const AMMA = { success: true, candidates: ['அம்மா', 'அம்மை', 'அம்ம'] };

const ROW: LexiconRow = {
  id: 'lex_1', word: 'நிலா', gloss: 'old meaning', register: 'sangam',
  usage: 'fresh', themes: [], usageCount: 0, archived: false,
};

describe('LexiconManager — Tamil typing on the word field', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => AMMA }) as Response);
  });
  afterEach(() => jest.restoreAllMocks());

  it('transliterates English in the "Add word" headword field (amma → அம்மா)', async () => {
    const user = userEvent.setup();
    render(<LexiconManager initial={[]} />);

    // Reveal the add form, then type into the headword field.
    await user.click(screen.getByRole('button', { name: /add word/i }));
    const wordField = screen.getByPlaceholderText('சொல்');
    await user.type(wordField, 'amma');

    // The transliteration dropdown surfaces Tamil candidates...
    expect(await screen.findByText('அம்மா')).toBeInTheDocument();
    // ...via our same-origin proxy.
    const url = String((global.fetch as jest.Mock).mock.calls.at(-1)?.[0]);
    expect(url).toContain('/api/admin/transliterate');
    expect(url).toContain('text=amma');
  });
});

describe('LexiconManager — full row editing', () => {
  afterEach(() => jest.restoreAllMocks());

  it('edits a word\'s gloss via PUT and reflects it in the table', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, opts?: RequestInit) => {
      calls.push({ url: String(url), method: opts?.method, body: opts?.body as string });
      return {
        ok: true, status: 200,
        json: async () => ({ success: true, data: { ...ROW, gloss: 'new meaning' } }),
      } as Response;
    });
    const user = userEvent.setup();
    render(<LexiconManager initial={[ROW]} />);

    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const glossInput = screen.getByLabelText('meaning');
    await user.clear(glossInput);
    await user.type(glossInput, 'new meaning');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toContain('/api/admin/lexicon/lex_1');
    expect(JSON.parse(put!.body!)).toMatchObject({ gloss: 'new meaning', word: 'நிலா' });
    expect(await screen.findByText('new meaning')).toBeInTheDocument();
  });
});

describe('LexiconManager — paste-import', () => {
  afterEach(() => jest.restoreAllMocks());

  it('parses pasted lines and bulk-imports them', async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, opts?: RequestInit) => {
      calls.push({ url: String(url), method: opts?.method, body: opts?.body as string });
      const u = String(url);
      if (u.includes('/bulk')) return { ok: true, status: 200, json: async () => ({ success: true, added: 2, skipped: 0 }) } as Response;
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) } as Response; // reload
    });
    const user = userEvent.setup();
    render(<LexiconManager initial={[]} />);

    await user.click(screen.getByRole('button', { name: /paste list/i }));
    fireEvent.change(screen.getByLabelText('paste words'), { target: { value: 'நிலா — moon\nகடல்' } });

    // The live counter reflects the parse.
    expect(screen.getByText(/2 ready/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /import 2/i }));

    const bulk = calls.find((c) => c.url.includes('/bulk'));
    expect(bulk?.method).toBe('POST');
    const sent = JSON.parse(bulk!.body!).words;
    expect(sent).toHaveLength(2);
    // ⚠️ NOT 'sangam'. The paste form used to default to LEXICON_REGISTERS[0],
    // which is how 1,046 of 1,047 live entries ended up filed as Sangam
    // vocabulary without anyone claiming they were. The default is now the
    // mildest available register.
    expect(sent[0]).toMatchObject({ word: 'நிலா', gloss: 'moon', register: 'literary' });
    expect(sent[1]).toMatchObject({ word: 'கடல்', gloss: '—' });
  });
});

describe('LexiconManager — export', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renders export controls and a populated table', () => {
    render(<LexiconManager initial={[ROW]} />);
    expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('நிலா')).toBeInTheDocument();
  });
});

/**
 * THE DATA-QUALITY PROGRESS LENS (Raj, 2026-08-14): the header count is the way
 * INTO the classification work, not a passive number. Clicking "N need review"
 * must show exactly those N rows, and there must be a way back out.
 */
describe('LexiconManager — "need review" count is a filter', () => {
  afterEach(() => jest.restoreAllMocks());

  const BARE: LexiconRow = {
    id: 'lex_bare', word: 'அகநேசம்', gloss: 'inward love', register: 'sangam',
    usage: 'fresh', themes: [], usageCount: 0, archived: false,
  };
  const DONE: LexiconRow = {
    id: 'lex_done', word: 'வைகறை', gloss: 'dawn', register: 'literary',
    usage: 'fresh', themes: ['dawn'], tamilMeaning: 'அதிகாலை', confidence: 'high',
    usageCount: 0, archived: false,
  };

  it('shows the count, then filters the table to exactly those rows when clicked', async () => {
    const user = userEvent.setup();
    render(<LexiconManager initial={[BARE, DONE]} />);

    // Both words are listed to begin with.
    expect(screen.getByText('அகநேசம்')).toBeInTheDocument();
    expect(screen.getByText('வைகறை')).toBeInTheDocument();

    const countButton = screen.getByRole('button', { name: /1 need review/i });
    expect(countButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(countButton);

    // Only the unreviewed word survives — and the count said 1.
    expect(screen.getByText('அகநேசம்')).toBeInTheDocument();
    expect(screen.queryByText('வைகறை')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 need review/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers a way back out, restoring the full list', async () => {
    const user = userEvent.setup();
    render(<LexiconManager initial={[BARE, DONE]} />);

    await user.click(screen.getByRole('button', { name: /1 need review/i }));
    expect(screen.queryByText('வைகறை')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /needs review ✕/i }));
    expect(screen.getByText('வைகறை')).toBeInTheDocument();
  });

  it('says "nothing left to review" rather than "no words match" when the queue empties', async () => {
    const user = userEvent.setup();
    render(<LexiconManager initial={[DONE]} />);

    // Nothing needs review, so the count is not rendered at all...
    expect(screen.queryByRole('button', { name: /need review/i })).not.toBeInTheDocument();
    // ...and a normal filter miss still reads as a filter miss.
    await user.type(screen.getByLabelText(/search lexicon/i), 'zzzznotfound');
    expect(screen.getByText(/no words match these filters/i)).toBeInTheDocument();
  });

  it('is off on first render — the table is never silently pre-filtered', () => {
    render(<LexiconManager initial={[BARE, DONE]} />);
    expect(screen.getByText('அகநேசம்')).toBeInTheDocument();
    expect(screen.getByText('வைகறை')).toBeInTheDocument();
  });
});

/**
 * BULK ROW-EDITING — the tool for correcting groups of words, and the only
 * practical way through the ~1,046 entries carrying a defaulted register.
 */
describe('LexiconManager — bulk selection', () => {
  afterEach(() => jest.restoreAllMocks());

  const A: LexiconRow = {
    id: 'lex_a', word: 'அகநேசம்', gloss: 'inward love', register: 'sangam',
    usage: 'fresh', themes: [], usageCount: 0, archived: false,
  };
  const B: LexiconRow = {
    id: 'lex_b', word: 'அகமண்', gloss: 'inner land', register: 'sangam',
    usage: 'fresh', themes: [], usageCount: 0, archived: false,
  };

  it('shows no bulk bar until something is selected', () => {
    render(<LexiconManager initial={[A, B]} />);
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
  });

  it('reveals the bar with a running count', async () => {
    const user = userEvent.setup();
    render(<LexiconManager initial={[A, B]} />);
    await user.click(screen.getByLabelText('select அகநேசம்'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    await user.click(screen.getByLabelText('select அகமண்'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('selects and deselects the whole page from the header checkbox', async () => {
    const user = userEvent.setup();
    render(<LexiconManager initial={[A, B]} />);
    await user.click(screen.getByLabelText('select all on this page'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByLabelText('select all on this page'));
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
  });

  it('posts the chosen register for exactly the selected ids', async () => {
    const calls: { url: string; body?: string }[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, opts?: RequestInit) => {
      calls.push({ url: String(url), body: opts?.body as string });
      return { ok: true, status: 200, json: async () => ({ success: true, updated: 1, failed: [], requested: 1 }) } as Response;
    });

    const user = userEvent.setup();
    render(<LexiconManager initial={[A, B]} />);
    await user.click(screen.getByLabelText('select அகநேசம்'));
    await user.click(screen.getByRole('button', { name: 'modern-poetic' }));
    await user.click(screen.getByRole('button', { name: /apply to 1/i }));

    const bulk = calls.find((c) => c.url.includes('/bulk-update'));
    expect(JSON.parse(bulk!.body!)).toEqual({ ids: ['lex_a'], registers: ['modern-poetic'] });
  });

  it('sends a theme as an ADD, never as a wholesale replace', async () => {
    const calls: { url: string; body?: string }[] = [];
    global.fetch = jest.fn(async (url: RequestInfo | URL, opts?: RequestInit) => {
      calls.push({ url: String(url), body: opts?.body as string });
      return { ok: true, status: 200, json: async () => ({ success: true, updated: 2, failed: [], requested: 2 }) } as Response;
    });

    const user = userEvent.setup();
    render(<LexiconManager initial={[A, B]} />);
    await user.click(screen.getByLabelText('select all on this page'));
    await user.selectOptions(screen.getByLabelText('bulk add theme'), 'nature');
    await user.click(screen.getByRole('button', { name: /apply to 2/i }));

    const body = JSON.parse(calls.find((c) => c.url.includes('/bulk-update'))!.body!);
    expect(body.addThemes).toEqual(['nature']);
    expect(body).not.toHaveProperty('themes');
  });

  it('will not apply an empty change', async () => {
    const user = userEvent.setup();
    render(<LexiconManager initial={[A, B]} />);
    await user.click(screen.getByLabelText('select அகநேசம்'));
    expect(screen.getByRole('button', { name: /apply to 1/i })).toBeDisabled();
  });
});
