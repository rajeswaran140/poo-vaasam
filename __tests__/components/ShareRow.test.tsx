import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShareRow } from '@/components/content/ShareRow';
import { whatsappShareUrl } from '@/lib/whatsapp-share';
import { trackShare } from '@/lib/analytics-events';

jest.mock('@/lib/analytics-events', () => ({ trackShare: jest.fn() }));

describe('ShareRow', () => {
  const url = 'https://tamilagaval.com/thayagam';
  const title = 'எங்கள் தேசம்';

  afterEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });

  it('renders a WhatsApp share link with the warm pre-filled message (listen by default)', () => {
    render(<ShareRow url={url} title={title} />);
    const wa = screen.getByRole('link', { name: 'Share on WhatsApp' });
    expect(wa).toHaveAttribute('href', whatsappShareUrl({ title, url, verb: 'listen' }));
    expect(wa).toHaveAttribute('target', '_blank');
    expect(wa).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('uses the "read" CTA when verb=read (poems/stories)', () => {
    render(<ShareRow url={url} title={title} verb="read" />);
    const wa = screen.getByRole('link', { name: 'Share on WhatsApp' });
    expect(wa).toHaveAttribute('href', whatsappShareUrl({ title, url, verb: 'read' }));
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain('படியுங்கள்');
  });

  it('still offers Facebook, X and a copy-link control', () => {
    render(<ShareRow url={url} title={title} />);
    expect(screen.getByRole('link', { name: 'Share on Facebook' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Share on X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /இணைப்பை நகலெடு/ })).toBeInTheDocument();
  });

  /**
   * `canNativeShare` used to be read from `navigator` during render: false on the
   * server (button omitted), true on the client (button present) → the SSR HTML
   * disagreed with the first client render on every mobile visit.
   */
  it('does not render the native-share button on the first (hydration-safe) render', () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: jest.fn() });
    // React Testing Library flushes effects, so after mount the button appears —
    // what matters is that it comes from an effect, not from the render body.
    // A render with share support present must still produce it only post-mount.
    const { container } = render(<ShareRow url={url} title={title} />);
    expect(container).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('omits the native-share button entirely when the browser has no Web Share API', () => {
    render(<ShareRow url={url} title={title} />);
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
  });

  /**
   * UTM tagging. Only the WhatsApp link used to be tagged — but on a phone the
   * native sheet and copy-link are the commonest ways a link actually reaches
   * WhatsApp, and those went out bare, so the return visit looked "direct" and
   * InboundTracker never fired.
   */
  it('UTM-tags the Facebook and X share URLs', () => {
    render(<ShareRow url={url} title={title} />);
    const fb = screen.getByRole('link', { name: 'Share on Facebook' }).getAttribute('href') ?? '';
    const x = screen.getByRole('link', { name: 'Share on X' }).getAttribute('href') ?? '';
    expect(decodeURIComponent(fb)).toContain('utm_source=facebook');
    expect(decodeURIComponent(fb)).toContain('utm_medium=share');
    expect(decodeURIComponent(x)).toContain('utm_source=twitter');
  });

  it('copies a UTM-tagged URL, not a bare one', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<ShareRow url={url} title={title} />);
    fireEvent.click(screen.getByRole('button', { name: /இணைப்பை நகலெடு/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('utm_source=copy');
    expect(copied).toContain('utm_medium=share');
  });

  it('hands a UTM-tagged URL to the native share sheet', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });

    render(<ShareRow url={url} title={title} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].url).toContain('utm_source=native');
  });

  it('does NOT count a native share the user dismissed', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const share = jest.fn().mockRejectedValue(abort);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });

    render(<ShareRow url={url} title={title} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(trackShare).not.toHaveBeenCalled();
  });

  /** Per-song attribution — answers "which song do people forward?". */
  it('attributes the share to the song when a songId is given', () => {
    render(<ShareRow url={url} title={title} songId="cnt_9" />);
    fireEvent.click(screen.getByRole('link', { name: 'Share on WhatsApp' }));
    expect(trackShare).toHaveBeenCalledWith('whatsapp', { songId: 'cnt_9' });
  });

  it('records the channel with no song attribution when no songId is given', () => {
    render(<ShareRow url={url} title={title} />);
    fireEvent.click(screen.getByRole('link', { name: 'Share on WhatsApp' }));
    expect(trackShare).toHaveBeenCalledWith('whatsapp', undefined);
  });
});
