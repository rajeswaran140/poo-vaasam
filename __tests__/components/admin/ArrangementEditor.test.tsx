import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ArrangementEditor } from '@/components/admin/ArrangementEditor';

const writeText = jest.fn().mockResolvedValue(undefined);
function installClipboard() {
  // See SunoSetupPanel.test — userEvent.setup() redefines navigator.clipboard
  // as getter-only and jsdom shares navigator across a file.
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true });
}

const LYRICS = ['பல்லவி ஒன்று\nபல்லவி இரண்டு', 'சரணம் ஒன்று', 'பல்லவி ஒன்று\nபல்லவி இரண்டு'].join('\n\n');
const INSTRUMENTS = ['Bamboo flute', 'Violin', 'Dholak'];

function renderEditor(props: Partial<React.ComponentProps<typeof ArrangementEditor>> = {}) {
  const onArranged = jest.fn();
  render(<ArrangementEditor lyrics={LYRICS} instruments={INSTRUMENTS} onArranged={onArranged} {...props} />);
  return { onArranged };
}
const expand = () => fireEvent.click(screen.getByRole('button', { name: /^arrangement/i }));

beforeEach(() => {
  writeText.mockClear();
  installClipboard();
});

describe('ArrangementEditor', () => {
  it('is collapsed and fetches nothing, showing the balance in the header', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: /^arrangement/i })).toHaveTextContent(/0 instrumental \/ 3 sung/);
  });

  it('says so plainly when there are no lyrics yet', () => {
    renderEditor({ lyrics: '' });
    expect(screen.getByRole('button', { name: /^arrangement/i })).toHaveTextContent(/paste lyrics first/i);
  });

  it('splits the lyric into sections and marks the repeated block a chorus', () => {
    renderEditor();
    expand();
    // 3 blocks; the repeated one is the chorus.
    expect((screen.getByLabelText('section 1 kind') as HTMLInputElement).value).toBe('Chorus');
    expect((screen.getByLabelText('section 2 kind') as HTMLInputElement).value).toBe('Verse');
  });

  it('only offers instruments the chosen variant carries', () => {
    // A break naming an instrument the style box lacks is the contradiction the
    // checker exists to catch — the editor must not be able to create one.
    renderEditor();
    expand();
    fireEvent.click(screen.getByLabelText('add layer to section 1'));
    const opts = Array.from(
      (screen.getByLabelText('section 1 layer 1 instrument') as HTMLSelectElement).options
    ).map((o) => o.value);
    expect(opts).toEqual(INSTRUMENTS);
  });

  it('builds [Kind - Detail] with bracketed direction lines under it', () => {
    renderEditor();
    expand();
    fireEvent.click(screen.getByLabelText('add layer to section 1'));
    fireEvent.change(screen.getByLabelText('section 1 layer 1 instrument'), { target: { value: 'Violin' } });
    fireEvent.change(screen.getByLabelText('section 1 layer 1 role'), { target: { value: 'sustains beneath' } });
    const block = screen.getByTestId('arrangement-block').textContent ?? '';
    expect(block).toContain('[Chorus - Male Lead]');
    expect(block).toContain('[Violin sustains beneath]');
  });

  it('lets a hand-written direction win over composed layers', () => {
    renderEditor();
    expand();
    fireEvent.click(screen.getByLabelText('add layer to section 1'));
    fireEvent.change(screen.getByLabelText('section 1 direction in your own words'), {
      target: { value: 'Ambient pad swell, distant village dusk' },
    });
    const block = screen.getByTestId('arrangement-block').textContent ?? '';
    expect(block).toContain('[Ambient pad swell, distant village dusk]');
    expect(block).not.toContain('sustains beneath');
  });

  it('inserts an instrumental break before a section and counts it', () => {
    renderEditor();
    expand();
    fireEvent.click(screen.getByLabelText('add break before section 2'));
    expect(screen.getByTestId('arrangement-block').textContent).toContain('[Break - Bamboo flute Phrase]');
    expect(screen.getByRole('button', { name: /^arrangement/i })).toHaveTextContent(/1 instrumental/);
  });

  it('removes a break again', () => {
    renderEditor();
    expand();
    fireEvent.click(screen.getByLabelText('add break before section 2'));
    fireEvent.click(screen.getByLabelText('remove break before section 2'));
    expect(screen.getByTestId('arrangement-block').textContent).not.toContain('[Break');
  });

  it('warns when nothing is instrumental — no way to hand the melody on', () => {
    renderEditor();
    expand();
    expect(screen.getByText(/nowhere for the melody/i)).toBeInTheDocument();
  });

  it('shows a recurring theme and the leads that carried it', () => {
    renderEditor();
    expand();
    // Sections 1 and 3 are both "Chorus"; give them different leads.
    fireEvent.change(screen.getByLabelText('section 3 lead'), { target: { value: 'Violin Lead' } });
    expect(screen.getByTestId('theme-statements')).toHaveTextContent(/Chorus/);
    expect(screen.getByTestId('theme-statements')).toHaveTextContent(/Male Lead → Violin Lead/);
  });

  it('copies the block and hands it upward', async () => {
    const { onArranged } = renderEditor();
    expand();
    fireEvent.click(screen.getByRole('button', { name: /copy arrangement/i }));
    expect(writeText).toHaveBeenCalled();
    await Promise.resolve();
    expect(onArranged).toHaveBeenCalled();
  });

  it('keeps edits to other sections when one is changed', async () => {
    const user = userEvent.setup();
    installClipboard();
    renderEditor();
    expand();
    fireEvent.change(screen.getByLabelText('section 1 lead'), { target: { value: 'Female Lead' } });
    fireEvent.change(screen.getByLabelText('section 2 lead'), { target: { value: 'Violin Lead' } });
    const block = screen.getByTestId('arrangement-block').textContent ?? '';
    expect(block).toContain('[Chorus - Female Lead]');
    expect(block).toContain('[Verse - Violin Lead]');
    await user.click(screen.getByRole('button', { name: /^arrangement/i })); // collapse, no crash
  });
});
