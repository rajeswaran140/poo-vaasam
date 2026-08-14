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
