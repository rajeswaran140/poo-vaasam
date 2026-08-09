import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SunoSetupPanel } from '@/components/admin/SunoSetupPanel';

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

const writeText = jest.fn().mockResolvedValue(undefined);

/**
 * Re-install per test. jsdom shares `navigator` across a file, and any earlier
 * `userEvent.setup()` redefines `navigator.clipboard` as a getter-only property
 * pointing at userEvent's own stub — so a module-level assign is silently
 * replaced by whichever test ran first. defineProperty overrides it either way.
 */
function installClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
}

const SETUP = {
  lyrics_block: '[Intro - Instrumental]\n[Chorus - Male Lead]\nவரி ஒன்று',
  style: 'Tamil ballad, 82 BPM | male baritone | bamboo flute',
  weirdness: 40,
  style_influence: 85,
  exclude: ['heavy metal'],
  slider_rationale: 'Dense prompt, conventional idiom.',
};

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

function renderPanel(props: Partial<React.ComponentProps<typeof SunoSetupPanel>> = {}) {
  const onArranged = jest.fn();
  render(
    <SunoSetupPanel
      lyrics="வரி ஒன்று"
      styleName="Tamil ballad"
      stylePrompt="A gentle Tamil ballad."
      instruments={['Bamboo flute']}
      onArranged={onArranged}
      {...props}
    />
  );
  return { onArranged };
}

beforeEach(() => {
  adminFetch.mockReset();
  writeText.mockClear();
  installClipboard();
});

describe('SunoSetupPanel', () => {
  it('fetches nothing until the button is pressed', () => {
    renderPanel();
    expect(adminFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /build suno setup/i })).toBeInTheDocument();
  });

  it('sends the chosen variant and its instruments so breaks cannot invent one', async () => {
    const user = userEvent.setup();
    adminFetch.mockResolvedValue(json(200, { success: true, setup: SETUP, findings: [], ready: true }));
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    await waitFor(() => expect(adminFetch).toHaveBeenCalled());
    const [url, init] = adminFetch.mock.calls[0];
    expect(url).toBe('/api/admin/compose/suno-setup');
    const body = JSON.parse(init.body);
    expect(body.style).toBe('Tamil ballad');
    expect(body.instruments).toEqual(['Bamboo flute']);
  });

  it('renders all four fields with the style character count', async () => {
    const user = userEvent.setup();
    adminFetch.mockResolvedValue(json(200, { success: true, setup: SETUP, findings: [], ready: true }));
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    expect(await screen.findByText(/\[Chorus - Male Lead\]/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${SETUP.style.length} / 1000`))).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText(/dense prompt/i)).toBeInTheDocument();
  });

  it('hands the arrangement upward so the export pack uses it', async () => {
    // A panel that displayed the block but left the pack un-arranged would look
    // done and paste wrong — this is the contract that prevents that.
    const user = userEvent.setup();
    adminFetch.mockResolvedValue(json(200, { success: true, setup: SETUP, findings: [], ready: true }));
    const { onArranged } = renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    await waitFor(() => expect(onArranged).toHaveBeenCalledWith(SETUP.lyrics_block, ['heavy metal']));
  });

  it('shows findings, and still shows the output when a check failed', async () => {
    const user = userEvent.setup();
    adminFetch.mockResolvedValue(
      json(200, {
        success: true,
        setup: SETUP,
        findings: [{ severity: 'error', field: 'exclude', message: 'contradicts the style', fix: 'remove one' }],
        ready: false,
      })
    );
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    expect(await screen.findByTestId('setup-findings')).toHaveTextContent(/contradicts the style/);
    expect(screen.getByText(/remove one/)).toBeInTheDocument();
    expect(screen.getByText(/\[Chorus - Male Lead\]/)).toBeInTheDocument(); // output preserved
  });

  it('copies a field to the clipboard', async () => {
    // fireEvent, NOT userEvent: userEvent.setup() installs its own clipboard
    // stub and redefines navigator.clipboard as getter-only, so the module
    // spy is both bypassed and impossible to re-attach afterwards.
    adminFetch.mockResolvedValue(json(200, { success: true, setup: SETUP, findings: [], ready: true }));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /build suno setup/i }));
    await screen.findByText(/\[Chorus - Male Lead\]/);
    fireEvent.click(screen.getByRole('button', { name: /copy lyrics box/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SETUP.lyrics_block));
  });

  it('surfaces an error without losing the button', async () => {
    const user = userEvent.setup();
    adminFetch.mockResolvedValue(json(502, { success: false, error: 'The AI service did not respond.' }));
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    expect(await screen.findByText(/did not respond/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /build suno setup/i })).toBeEnabled();
  });

  it('cannot be pressed with no lyrics', () => {
    renderPanel({ lyrics: '   ' });
    expect(screen.getByRole('button', { name: /build suno setup/i })).toBeDisabled();
  });

  it('flags a style outside the useful band', async () => {
    const user = userEvent.setup();
    adminFetch.mockResolvedValue(
      json(200, { success: true, setup: { ...SETUP, style: 'short' }, findings: [], ready: true })
    );
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    expect(await screen.findByText(/outside the useful band/i)).toBeInTheDocument();
  });
});
