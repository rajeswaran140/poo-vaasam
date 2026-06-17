import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LexiconManager } from '@/components/admin/LexiconManager';

// Our transliteration proxy shape for "amma".
const AMMA = { success: true, candidates: ['அம்மா', 'அம்மை', 'அம்ம'] };

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
