import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricAssistPanel } from '@/components/admin/LyricAssistPanel';
import type { LexiconWord } from '@/types/lexicon';

const lex = (w: string, themes: string[] = ['love']): LexiconWord => ({
  id: w,
  word: w,
  gloss: `${w} meaning`,
  register: 'modern',
  usage: 'neutral',
  themes,
  usageCount: 0,
  archived: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

async function expand() {
  await userEvent.click(screen.getByRole('button', { name: /flow & words/i }));
}

function renderPanel(props: Partial<React.ComponentProps<typeof LyricAssistPanel>> = {}) {
  const onUseWord = jest.fn();
  const onFirstOpen = jest.fn();
  render(
    <LyricAssistPanel
      lyrics=""
      selectedWord=""
      lexicon={[]}
      theme="love"
      register="modern"
      onUseWord={onUseWord}
      onFirstOpen={onFirstOpen}
      {...props}
    />
  );
  return { onUseWord, onFirstOpen };
}

describe('LyricAssistPanel — word inspector', () => {
  it('prompts for a selection when there is none', async () => {
    renderPanel();
    await expand();
    expect(screen.getByText(/put the cursor on a word/i)).toBeInTheDocument();
  });

  it('reports syllables and the consequence of a closed ending', async () => {
    renderPanel({ selectedWord: 'கண்ணில்' });
    await expand();
    expect(screen.getByText(/syllable/i)).toBeInTheDocument();
    expect(screen.getByText(/clip/i)).toBeInTheDocument();
  });

  it('offers lexicon candidates and reports the choice upward without changing anything itself', async () => {
    const user = userEvent.setup();
    const { onUseWord } = renderPanel({
      selectedWord: 'கண்ணே',
      lexicon: [lex('மணியே'), lex('நிலவே')],
    });
    await expand();
    const list = screen.getByTestId('word-candidates');
    expect(list).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'மணியே' }));
    expect(onUseWord).toHaveBeenCalledWith('மணியே');
  });

  it('says so plainly when the lexicon has nothing relevant, rather than padding', async () => {
    renderPanel({
      selectedWord: 'கண்',
      lexicon: [{ ...lex('வானவில்லேயோ', ['nature']), register: 'sangam' }],
      theme: 'love',
      register: 'modern',
    });
    await expand();
    expect(screen.queryByTestId('word-candidates')).not.toBeInTheDocument();
    expect(screen.getByText(/nothing in your lexicon/i)).toBeInTheDocument();
  });

  it('frames candidates as offered, not as corrections', async () => {
    renderPanel({ selectedWord: 'கண்ணே', lexicon: [lex('மணியே')] });
    await expand();
    expect(screen.getByText(/not corrections/i)).toBeInTheDocument();
  });
});

describe('LyricAssistPanel — flow', () => {
  it('stays quiet on a clean, consistent draft', async () => {
    renderPanel({ lyrics: ['கண்ணே', 'மணியே', 'நிலவே', 'மலரே'].join('\n') });
    await expand();
    expect(screen.getByText(/nothing flagged/i)).toBeInTheDocument();
    expect(screen.queryByTestId('flow-suggestions')).not.toBeInTheDocument();
  });

  it('lists a suggestion with its line number, observation and reason', async () => {
    renderPanel({
      lyrics: ['கண்ணா', 'மண்ணா', 'விண்ணா', 'கண்ணாலே பார்த்தாயே நீயும் என்னை அன்பாக'].join('\n'),
    });
    await expand();
    const list = screen.getByTestId('flow-suggestions');
    expect(list).toBeInTheDocument();
    expect(screen.getByText(/line 4/)).toBeInTheDocument();
  });

  it('expands and collapses, fetching nothing until first opened', async () => {
    const user = userEvent.setup();
    renderPanel({ lyrics: 'கண்ணே\nமணியே\nநிலவே\nமலரே' });
    const toggle = screen.getByRole('button', { name: /flow & words/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/put the cursor on a word/i)).toBeInTheDocument();
  });
});

describe('LyricAssistPanel — laziness', () => {
  it('does not signal a fetch until the panel is first opened, and only once', async () => {
    const user = userEvent.setup();
    const { onFirstOpen } = renderPanel({ lyrics: 'கண்ணே\nமணியே' });
    expect(onFirstOpen).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: /flow & words/i });
    await user.click(toggle);
    expect(onFirstOpen).toHaveBeenCalledTimes(1);
    await user.click(toggle);
    await user.click(toggle);
    expect(onFirstOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the flow headline while still collapsed, with no fetch', () => {
    const { onFirstOpen } = renderPanel({
      lyrics: ['கண்ணா', 'மண்ணா', 'விண்ணா', 'கண்ணாலே பார்த்தாயே நீயும் என்னை அன்பாக'].join('\n'),
    });
    expect(screen.getByRole('button', { name: /worth a look/i })).toBeInTheDocument();
    expect(onFirstOpen).not.toHaveBeenCalled();
  });
});
