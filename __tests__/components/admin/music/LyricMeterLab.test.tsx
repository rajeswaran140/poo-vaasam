/**
 * Lyric Meter Lab.
 *
 * The tests that matter are the authorship ones: the line must never be
 * rewritten, and a suggested meter must never render as a determined one.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LyricMeterLab } from '@/components/admin/music/LyricMeterLab';

jest.mock('@/lib/music/audio-engine', () => ({
  audioEngine: {
    resume: jest.fn(async () => {}),
    playNote: jest.fn(),
    startMetronome: jest.fn(async () => {}),
    stopMetronome: jest.fn(),
    stopAll: jest.fn(),
    setVolume: jest.fn(),
    onPulse: jest.fn(() => () => {}),
  },
}));

const LINE = 'மழை பெய்தால் மண் வாசம்';

const type = (value: string) => fireEvent.change(screen.getByLabelText('lyric line'), { target: { value } });

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: [] }) }) as Response);
  Object.assign(navigator, { clipboard: { writeText: jest.fn() } });
});
afterEach(() => jest.restoreAllMocks());

describe('structural breakdown', () => {
  it('shows no analysis until a line is entered', () => {
    render(<LyricMeterLab />);
    expect(screen.queryByText('Phrase A')).not.toBeInTheDocument();
    expect(screen.queryByText('Suggested')).not.toBeInTheDocument();
  });

  it('breaks the line into its words, unaltered', () => {
    render(<LyricMeterLab />);
    type(LINE);
    for (const w of ['மழை', 'பெய்தால்', 'மண்', 'வாசம்']) {
      expect(screen.getByLabelText(`inspect ${w}`)).toBeInTheDocument();
    }
  });

  it('counts syllables for the line', () => {
    render(<LyricMeterLab />);
    type(LINE);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  /**
   * ⚠️ A STANZA IS NOT ONE PHRASE. Four lines used to be measured as one
   * continuous run, reporting an impossible density for a lyric that sings
   * fine. Each line now gets its own card and its own estimate.
   */
  it('gives every line its own card and its own density', () => {
    render(<LyricMeterLab />);
    type('பூபாளம் பாடும் நேரமே\nபுதுக்கோலம் பூணும் வானமே');
    expect(screen.getByText('line 1')).toBeInTheDocument();
    expect(screen.getByText('line 2')).toBeInTheDocument();
    expect(screen.getAllByText(/Estimated vocal density/i)).toHaveLength(2);
  });

  it('summarises the stanza with counts but NO stanza-level density', () => {
    render(<LyricMeterLab />);
    type('பூபாளம் பாடும் நேரமே\nபுதுக்கோலம் பூணும் வானமே');
    expect(screen.getByText(/2 lines · 17 syllables/)).toBeInTheDocument();
    expect(screen.getByText(/a verse is not one continuous phrase/i)).toBeInTheDocument();
  });

  /** ⚠️ Hedged, never a verdict. */
  it('labels density as an estimate rather than calling the line rushed', () => {
    render(<LyricMeterLab />);
    type(LINE);
    expect(screen.getByText(/Estimated vocal density/i)).toBeInTheDocument();
    expect(screen.queryByText(/\brushed\b/i)).not.toBeInTheDocument();
  });

  it('splits into phrases on word boundaries and can be re-split', () => {
    render(<LyricMeterLab />);
    type(LINE);
    expect(screen.getByText('Phrase A')).toBeInTheDocument();
    expect(screen.getByText('Phrase B')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(screen.getByText('Phrase C')).toBeInTheDocument();
  });
});

/**
 * ⚠️ §24. "Meter: 6/8" and "Suggested meter: 6/8" are different claims. The
 * suggestion must be badged, reasoned, and separated from the meter the poet
 * actually picked.
 */
describe('a suggested meter never renders as a determined one', () => {
  it('badges the suggestion and marks the chosen meter as user-entered', () => {
    render(<LyricMeterLab />);
    type(LINE);
    expect(screen.getByText('Suggested')).toBeInTheDocument();
    expect(screen.getByText(/user-entered/i)).toBeInTheDocument();
  });

  it('always prints the reasoning next to it', () => {
    render(<LyricMeterLab />);
    type(LINE);
    // Match the reasoning specifically — the phrase-splitter caption also
    // contains "a starting point".
    expect(screen.getByText(/^7 syllables .*(tune decides|starting point|Sing it before)/i)).toBeInTheDocument();
  });

  /**
   * ⚠️ 3/4 and 6/8 differ by ACCENT GROUPING, which text cannot express. Naming
   * one as "suggested" would be a musically meaningless answer delivered
   * confidently, so the UI says the count cannot choose.
   */
  it('says the count cannot choose, instead of naming a winner', () => {
    render(<LyricMeterLab />);
    type('மழை பெய்தால் மண்ணில்'); // 6 syllables — fits 3/4 AND 6/8
    expect(screen.getByText(/cannot choose a meter/i)).toBeInTheDocument();
    expect(screen.getByText(/accent grouping/i)).toBeInTheDocument();
    expect(screen.queryByText('Suggested')).not.toBeInTheDocument();
  });
});

/** ⚠️ The line belongs to the poet. */
describe('authorship', () => {
  it('leaves the text exactly as typed after inspecting a word', () => {
    render(<LyricMeterLab />);
    type(LINE);
    fireEvent.click(screen.getByLabelText('inspect வாசம்'));
    expect(screen.getByLabelText('lyric line')).toHaveValue(LINE);
  });

  it('copies a chosen alternative to the clipboard instead of editing the line', async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes('/alternatives')) {
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, data: [{ word: 'மணம்', gloss: 'fragrance', nuance: 'more delicate than வாசம்' }] }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) } as Response;
    });

    render(<LyricMeterLab />);
    type(LINE);
    fireEvent.click(screen.getByLabelText('inspect வாசம்'));
    fireEvent.click(screen.getByRole('button', { name: /find alternatives/i }));

    const pick = await screen.findByRole('button', { name: 'மணம்' });
    fireEvent.click(pick);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('மணம்');
    // The line is untouched.
    expect(screen.getByLabelText('lyric line')).toHaveValue(LINE);
  });

  it('shows the nuance for every alternative, never a bare synonym list', async () => {
    global.fetch = jest.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/alternatives')) {
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, data: [{ word: 'மணம்', gloss: 'fragrance', nuance: 'more delicate than வாசம்' }] }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ success: true, data: [] }) } as Response;
    });

    render(<LyricMeterLab />);
    type(LINE);
    fireEvent.click(screen.getByLabelText('inspect வாசம்'));
    fireEvent.click(screen.getByRole('button', { name: /find alternatives/i }));
    expect(await screen.findByText(/more delicate than/i)).toBeInTheDocument();
  });
});

describe('word inspection', () => {
  it('reports குறில்/நெடில் and whether the word can be sustained', () => {
    render(<LyricMeterLab />);
    type('வா');
    fireEvent.click(screen.getByLabelText('inspect வா'));
    expect(screen.getByText(/நெடில்/)).toBeInTheDocument();
    expect(screen.getByText(/can be sustained/i)).toBeInTheDocument();
  });

  it('says a closed ending clips the note', () => {
    render(<LyricMeterLab />);
    type('மண்');
    fireEvent.click(screen.getByLabelText('inspect மண்'));
    expect(screen.getByText(/clips the note/i)).toBeInTheDocument();
  });

  it('queries the Lexicon for the selected word', async () => {
    render(<LyricMeterLab />);
    type(LINE);
    fireEvent.click(screen.getByLabelText('inspect வாசம்'));
    fireEvent.click(screen.getByRole('button', { name: /look up in lexicon/i }));
    await waitFor(() => {
      const urls = (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/api/admin/lexicon?q='))).toBe(true);
    });
  });

  it('says so plainly when the word is not in the Lexicon', async () => {
    render(<LyricMeterLab />);
    type(LINE);
    fireEvent.click(screen.getByLabelText('inspect வாசம்'));
    fireEvent.click(screen.getByRole('button', { name: /look up in lexicon/i }));
    expect(await screen.findByText(/not in your lexicon yet/i)).toBeInTheDocument();
  });
});

/** ⚠️ Orthographic parsing is not sung syllabification — the poet can correct it. */
describe('manual musical phrasing', () => {
  const openWord = (w: string) => {
    type('பூமியில் மழை');
    fireEvent.click(screen.getByLabelText(`inspect ${w}`));
  };

  it('shows the automatic reading and an empty manual field, not one merged number', () => {
    render(<LyricMeterLab />);
    openWord('பூமியில்');
    expect(screen.getByText(/Automatic analysis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Manual musical phrasing/i)).toHaveValue(null);
  });

  it('applies the override to the line without touching the lyric text', () => {
    render(<LyricMeterLab />);
    openWord('பூமியில்');
    fireEvent.change(screen.getByLabelText(/Manual musical phrasing/i), { target: { value: '2' } });

    // The word now counts 2, marked as overridden.
    expect(screen.getByLabelText('inspect பூமியில்').textContent).toMatch(/2\*/);
    // The lyric is untouched.
    expect(screen.getByLabelText('lyric line')).toHaveValue('பூமியில் மழை');
  });

  it('can be reset back to the parser', () => {
    render(<LyricMeterLab />);
    openWord('பூமியில்');
    fireEvent.change(screen.getByLabelText(/Manual musical phrasing/i), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /reset to automatic/i }));
    expect(screen.getByLabelText('inspect பூமியில்').textContent).not.toMatch(/\*/);
  });

  it('says plainly that the lyric is not changed', () => {
    render(<LyricMeterLab />);
    openWord('பூமியில்');
    expect(screen.getByText(/your lyric is not changed/i)).toBeInTheDocument();
  });
});
