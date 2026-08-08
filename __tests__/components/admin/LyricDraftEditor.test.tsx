import { render, screen } from '@testing-library/react';
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
});
