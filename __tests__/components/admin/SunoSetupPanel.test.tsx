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

/**
 * The panel enqueues then polls — one 202 with a jobId, then a job read.
 * It runs on the worker because the inline version 504'd on every real song.
 */
function wireEnqueueAndPoll(jobBody: unknown, enqueueStatus = 202) {
  adminFetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      return Promise.resolve(
        json(enqueueStatus, enqueueStatus < 400
          ? { success: true, jobId: 'suno_1786000000000_abc123xyz', status: 'processing' }
          : { success: false, error: 'Could not start the SUNO setup job. Please try again.' })
      );
    }
    return Promise.resolve(json(200, jobBody));
  });
}

const DONE = { success: true, status: 'done', result: { setup: SETUP, findings: [], ready: true }, error: null };

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
    wireEnqueueAndPoll(DONE);
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    await waitFor(() => expect(adminFetch).toHaveBeenCalled());
    const enqueue = adminFetch.mock.calls.find(([, i]: [string, { method?: string }]) => i?.method === 'POST');
    const [url, init] = enqueue!;
    expect(url).toBe('/api/admin/compose/suno-setup');
    const body = JSON.parse(init.body);
    expect(body.style).toBe('Tamil ballad');
    expect(body.instruments).toEqual(['Bamboo flute']);
  });

  it('renders all four fields with the style character count', async () => {
    const user = userEvent.setup();
    wireEnqueueAndPoll(DONE);
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
    wireEnqueueAndPoll(DONE);
    const { onArranged } = renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    await waitFor(() => expect(onArranged).toHaveBeenCalledWith(SETUP.lyrics_block, ['heavy metal']));
  });

  it('shows findings, and still shows the output when a check failed', async () => {
    const user = userEvent.setup();
    wireEnqueueAndPoll({
      success: true,
      status: 'done',
      result: {
        setup: SETUP,
        findings: [{ severity: 'error', field: 'exclude', message: 'contradicts the style', fix: 'remove one' }],
        ready: false,
      },
      error: null,
    });
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
    wireEnqueueAndPoll(DONE);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /build suno setup/i }));
    await screen.findByText(/\[Chorus - Male Lead\]/);
    fireEvent.click(screen.getByRole('button', { name: /copy lyrics box/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SETUP.lyrics_block));
  });

  it('surfaces an error without losing the button', async () => {
    const user = userEvent.setup();
    wireEnqueueAndPoll(DONE, 502);
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    expect(await screen.findByText(/could not start the suno setup job/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /build suno setup/i })).toBeEnabled();
  });

  it('cannot be pressed with no lyrics', () => {
    renderPanel({ lyrics: '   ' });
    expect(screen.getByRole('button', { name: /build suno setup/i })).toBeDisabled();
  });

  it('flags a style outside the useful band', async () => {
    const user = userEvent.setup();
    wireEnqueueAndPoll({ success: true, status: 'done', result: { setup: { ...SETUP, style: 'short' }, findings: [], ready: true }, error: null });
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    expect(await screen.findByText(/outside the useful band/i)).toBeInTheDocument();
  });
});

describe('SunoSetupPanel — runs on the worker, not inline', () => {
  it('enqueues then POLLS the job, never awaiting the model on the request', async () => {
    // The inline version returned 504 on every real song (Amplify's ~30s SSR
    // ceiling). Two calls — a POST enqueue and at least one GET poll — is the
    // shape that proves it went to the worker.
    const user = userEvent.setup();
    wireEnqueueAndPoll(DONE);
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    await screen.findByText(/\[Chorus - Male Lead\]/);
    const urls = adminFetch.mock.calls.map(([u]: [string]) => String(u));
    expect(urls.some((u) => u === '/api/admin/compose/suno-setup')).toBe(true);
    expect(urls.some((u) => u.startsWith('/api/admin/compose/suno-setup/suno_'))).toBe(true);
  });

  it('surfaces a worker-reported error instead of hanging until the poll deadline', async () => {
    const user = userEvent.setup();
    wireEnqueueAndPoll({
      success: true,
      status: 'error',
      result: null,
      error: { code: 'upstream', message: 'The AI service failed. Please try again.' },
    });
    renderPanel();
    await user.click(screen.getByRole('button', { name: /build suno setup/i }));
    expect(await screen.findByText(/the ai service failed/i)).toBeInTheDocument();
  });
});
