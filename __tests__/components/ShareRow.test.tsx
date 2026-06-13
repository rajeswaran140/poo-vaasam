import { render, screen } from '@testing-library/react';
import { ShareRow } from '@/components/content/ShareRow';
import { whatsappShareUrl } from '@/lib/whatsapp-share';

describe('ShareRow', () => {
  const url = 'https://tamilagaval.com/thayagam';
  const title = 'எங்கள் தேசம்';

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
    // The encoded message carries the "read" Tamil CTA.
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain('படியுங்கள்');
  });

  it('still offers Facebook, X and a copy-link control', () => {
    render(<ShareRow url={url} title={title} />);
    expect(screen.getByRole('link', { name: 'Share on Facebook' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Share on X' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /இணைப்பை நகலெடு/ })).toBeInTheDocument();
  });
});
