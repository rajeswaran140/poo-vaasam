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

  it('names the meters that fit equally well when the line is ambiguous', () => {
    render(<LyricMeterLab />);
    type('மழை பெய்தால் மண்ணில்'); // 6 syllables — fits 3/4 AND 6/8
    expect(screen.getByText(/fits equally/i)).toBeInTheDocument();
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
