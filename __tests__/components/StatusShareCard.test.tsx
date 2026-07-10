import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StatusShareCard } from '@/components/status/StatusShareGallery';
import { trackShare } from '@/lib/analytics-events';
import { whatsappShareUrl } from '@/lib/whatsapp-share';
import { absoluteUrl } from '@/lib/seo';

jest.mock('@/lib/analytics-events', () => ({ trackShare: jest.fn() }));

const view = {
  songId: 'cnt_test_1',
  title: 'எங்கள் தேசம்',
  path: '/thayagam',
  clip: '/clips/engaldesam-short.mp4',
  cover: 'https://cdn.example/cover.jpg',
};

function setShareApi(value: { share?: unknown; canShare?: unknown }) {
  for (const k of ['share', 'canShare'] as const) {
    if (k in value) {
      Object.defineProperty(navigator, k, { configurable: true, value: value[k] });
    } else {
      // remove so feature-detection sees it as unsupported
      Object.defineProperty(navigator, k, { configurable: true, value: undefined });
    }
  }
}

afterEach(() => {
  jest.clearAllMocks();
  setShareApi({}); // reset to "unsupported"
});

// Relative luminance + WCAG contrast ratio (sRGB) — for the a11y assertion below.
function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const h = hex.replace('#', '');
    const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const [l1, l2] = [lum(hexA), lum(hexB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

describe('StatusShareCard', () => {
  it('renders the clip, a download control, and a full-song link', () => {
    render(<StatusShareCard {...view} />);
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', view.clip);
    expect(video).toHaveAttribute('poster', view.cover);

    const dl = screen.getByLabelText(/சேமி/);
    expect(dl).toHaveAttribute('href', view.clip);
    expect(dl).toHaveAttribute('download', 'engaldesam-short.mp4');

    expect(screen.getByRole('link', { name: /முழுப் பாடல்/ })).toHaveAttribute('href', view.path);
  });

  it('uses a share-button colour that passes WCAG AA contrast with white text', () => {
    render(<StatusShareCard {...view} />);
    const btn = screen.getByRole('button', { name: /Status-இல் பகிருங்கள்/ });
    const bg = btn.className.match(/bg-\[#([0-9a-fA-F]{6})\]/);
    expect(bg).not.toBeNull(); // button fill is an explicit hex
    // White-on-fill must clear AA for normal text (4.5:1).
    expect(contrastRatio('#ffffff', `#${bg![1]}`)).toBeGreaterThanOrEqual(4.5);
  });

  it('shares the actual video FILE when the browser supports file sharing', async () => {
    const share = jest.fn().mockResolvedValue(undefined);
    const canShare = jest.fn().mockReturnValue(true);
    setShareApi({ share, canShare });
    global.fetch = jest.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['x'], { type: 'video/mp4' })),
    }) as unknown as typeof fetch;

    render(<StatusShareCard {...view} />);
    fireEvent.click(screen.getByRole('button', { name: /Status-இல் பகிருங்கள்/ }));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith(view.clip);
    const arg = share.mock.calls[0][0];
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]).toBeInstanceOf(File);
    expect(arg.files[0].name).toBe('engaldesam-short.mp4');
    expect(trackShare).toHaveBeenCalledWith('whatsapp_status', {
      songId: 'cnt_test_1',
      assetId: 'engaldesam-short',
    });
    // The shared caption carries source-song attribution (utm_content = songId).
    expect(arg.text).toContain('utm_medium=whatsapp_status');
    expect(arg.text).toContain('utm_content=cnt_test_1');
  });

  it('falls back to a wa.me link share on desktop / unsupported browsers', async () => {
    setShareApi({}); // no navigator.share
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    render(<StatusShareCard {...view} />);
    fireEvent.click(screen.getByRole('button', { name: /Status-இல் பகிருங்கள்/ }));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        whatsappShareUrl({
          title: view.title,
          url: absoluteUrl(view.path),
          verb: 'listen',
          utm: { utm_medium: 'whatsapp_status', utm_campaign: 'status_share', utm_content: view.songId },
        }),
        '_blank',
        'noopener,noreferrer',
      ),
    );
    expect(trackShare).toHaveBeenCalledWith('whatsapp_status', {
      songId: 'cnt_test_1',
      assetId: 'engaldesam-short',
    });
    openSpy.mockRestore();
  });

  it('does NOT fall back to the link when the user dismisses the share sheet', async () => {
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const share = jest.fn().mockRejectedValue(abort);
    const canShare = jest.fn().mockReturnValue(true);
    setShareApi({ share, canShare });
    global.fetch = jest.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['x'], { type: 'video/mp4' })),
    }) as unknown as typeof fetch;
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    render(<StatusShareCard {...view} />);
    fireEvent.click(screen.getByRole('button', { name: /Status-இல் பகிருங்கள்/ }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(openSpy).not.toHaveBeenCalled(); // dismissal is not an error
    openSpy.mockRestore();
  });
});
