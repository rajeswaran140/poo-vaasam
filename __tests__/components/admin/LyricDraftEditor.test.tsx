import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LyricDraftEditor } from '@/components/admin/LyricDraftEditor';

// react-transliterate opens a network-backed suggestion popup on every word,
// which is not what this component is responsible for. Stub it down to a plain
// textarea so the tests cover THIS component's contract: the mode toggle, the
// status indicator, and that both modes write to the same value.
jest.mock('react-transliterate', () => ({
  ReactTransliterate: ({
    value,
    onChangeText,
    renderComponent,
    placeholder,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    renderComponent: (p: Record<string, unknown>) => React.ReactElement;
    placeholder?: string;
  }) =>
    renderComponent({
      value,
      placeholder,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChangeText(e.target.value),
    }),
}));
jest.mock('react-transliterate/dist/index.css', () => ({}), { virtual: true });

// jsdom has no navigator.clipboard by default. Install a stub before every
// test so the copy button can be exercised end-to-end.
const writeText = jest.fn().mockResolvedValue(undefined);
beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

function setup(props: Partial<React.ComponentProps<typeof LyricDraftEditor>> = {}) {
  const onChange = jest.fn();
  render(<LyricDraftEditor id="ed" value="" onChange={onChange} {...props} />);
  return { onChange };
}

describe('LyricDraftEditor', () => {
  it('starts in English → Tamil transliteration mode', () => {
    setup();
    const toggle = screen.getByRole('button', { name: /english → tamil/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles to direct Tamil input and back', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: /english → tamil/i }));
    const direct = screen.getByRole('button', { name: /direct tamil/i });
    expect(direct).toHaveAttribute('aria-pressed', 'false');
    await user.click(direct);
    expect(screen.getByRole('button', { name: /english → tamil/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reports typed text through onChange in transliteration mode', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.type(screen.getByRole('textbox'), 'ka');
    expect(onChange).toHaveBeenCalled();
  });

  it('reports typed text through onChange in direct mode too', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('button', { name: /english → tamil/i }));
    await user.type(screen.getByRole('textbox'), 'க');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders the autosave status, and nothing at all when clean', () => {
    const { unmount } = render(<LyricDraftEditor id="a" value="" onChange={() => {}} status="dirty" />);
    expect(screen.getByTestId('autosave-status')).toHaveTextContent(/unsaved changes/i);
    unmount();
    render(<LyricDraftEditor id="b" value="" onChange={() => {}} status="clean" />);
    expect(screen.queryByTestId('autosave-status')).not.toBeInTheDocument();
  });

  it('reassures rather than alarms when a save failed', () => {
    render(<LyricDraftEditor id="c" value="" onChange={() => {}} status="error" />);
    expect(screen.getByTestId('autosave-status')).toHaveTextContent(/still here/i);
  });

  it('appends the detail hint only once saved', () => {
    const { unmount } = render(
      <LyricDraftEditor id="d" value="" onChange={() => {}} status="saved" statusDetail="12:04" />
    );
    expect(screen.getByTestId('autosave-status')).toHaveTextContent('12:04');
    unmount();
    render(<LyricDraftEditor id="e" value="" onChange={() => {}} status="dirty" statusDetail="12:04" />);
    expect(screen.getByTestId('autosave-status')).not.toHaveTextContent('12:04');
  });

  it('honours maxLength so a draft cannot exceed what the API accepts', () => {
    render(<LyricDraftEditor id="f" value="" onChange={() => {}} maxLength={8000} />);
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '8000');
  });

  describe('expand to full screen', () => {
    it('starts collapsed and toggles to expanded on click', async () => {
      const user = userEvent.setup();
      setup();
      const expandBtn = screen.getByRole('button', { name: /expand editor to full screen/i });
      expect(expandBtn).toHaveAttribute('aria-pressed', 'false');
      await user.click(expandBtn);
      const collapseBtn = screen.getByRole('button', { name: /collapse editor/i });
      expect(collapseBtn).toHaveAttribute('aria-pressed', 'true');
    });

    it('collapses on Escape', async () => {
      const user = userEvent.setup();
      setup();
      await user.click(screen.getByRole('button', { name: /expand editor to full screen/i }));
      expect(screen.getByRole('button', { name: /collapse editor/i })).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('button', { name: /expand editor to full screen/i })).toBeInTheDocument();
    });

    it('preserves typed value across expand / collapse (same DOM tree, no remount)', async () => {
      const user = userEvent.setup();
      setup({ value: 'மாதம் மலரும்' });
      // Enter expanded mode
      await user.click(screen.getByRole('button', { name: /expand editor to full screen/i }));
      // Value is still displayed by the textarea.
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('மாதம் மலரும்');
      // Collapse — value still there.
      await user.click(screen.getByRole('button', { name: /collapse editor/i }));
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('மாதம் மலரும்');
    });

    it('centres the textarea column in expanded mode (no full-viewport line length)', async () => {
      const user = userEvent.setup();
      setup({ value: 'x' });
      await user.click(screen.getByRole('button', { name: /expand editor to full screen/i }));
      // The wrapper immediately around the textarea gets the centring classes
      // — the textarea itself sits inside `<div class="… mx-auto max-w-3xl …">`.
      const textarea = screen.getByRole('textbox');
      const wrapper = textarea.closest('div');
      expect(wrapper?.className).toMatch(/mx-auto/);
      expect(wrapper?.className).toMatch(/max-w-3xl/);
    });

    it('locks body scroll only while expanded', async () => {
      const user = userEvent.setup();
      document.body.style.overflow = '';
      setup();
      expect(document.body.style.overflow).toBe('');
      await user.click(screen.getByRole('button', { name: /expand editor to full screen/i }));
      expect(document.body.style.overflow).toBe('hidden');
      await user.click(screen.getByRole('button', { name: /collapse editor/i }));
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('copy all', () => {
    // Using fireEvent rather than userEvent — v14's user.click adds
    // hoverability + focus checks that were dropping the call silently on
    // Tamil-value inputs in CI (the counterpart tests here that do pass
    // use short ASCII values). fireEvent dispatches the click directly and
    // is the same pattern LyricReadView.test.tsx uses successfully.
    it('copies the whole draft to the clipboard on click', () => {
      setup({ value: 'கண்ணே\nஉன்னைக் காண' });
      fireEvent.click(screen.getByRole('button', { name: /copy all lyrics/i }));
      expect(writeText).toHaveBeenCalledWith('கண்ணே\nஉன்னைக் காண');
    });

    it('disables the copy button when there is nothing to copy', () => {
      setup({ value: '   ' });
      expect(screen.getByRole('button', { name: /copy all lyrics/i })).toBeDisabled();
    });

    it('flashes a "Copied" state after a successful copy', async () => {
      setup({ value: 'x' });
      fireEvent.click(screen.getByRole('button', { name: /copy all lyrics/i }));
      // The button text switches from "Copy" to "Copied" once the async
      // writeText resolves. findByText polls until React re-renders.
      await screen.findByText(/copied/i);
    });
  });
});
