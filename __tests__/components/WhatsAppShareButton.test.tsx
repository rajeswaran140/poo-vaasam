import { render, screen } from '@testing-library/react';
import { WhatsAppShareButton } from '@/components/content/WhatsAppShareButton';
import { whatsappShareUrl } from '@/lib/whatsapp-share';

describe('WhatsAppShareButton', () => {
  const url = 'https://tamilagaval.com/thayagam';
  const title = 'எங்கள் தேசம்';

  it('links to wa.me with the warm pre-filled message (listen by default)', () => {
    render(<WhatsAppShareButton url={url} title={title} />);
    const wa = screen.getByRole('link', { name: /எங்கள் தேசம்.*WhatsApp/ });
    expect(wa).toHaveAttribute('href', whatsappShareUrl({ title, url, verb: 'listen' }));
    expect(wa).toHaveAttribute('target', '_blank');
    expect(wa).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('uses the "read" CTA when verb=read', () => {
    render(<WhatsAppShareButton url={url} title={title} verb="read" />);
    const wa = screen.getByRole('link', { name: /WhatsApp/ });
    expect(decodeURIComponent(wa.getAttribute('href') ?? '')).toContain('படியுங்கள்');
  });

  it('passes the absolute content URL through to the share text (WhatsApp needs absolute)', () => {
    render(<WhatsAppShareButton url={url} title={title} />);
    const href = screen.getByRole('link', { name: /WhatsApp/ }).getAttribute('href') ?? '';
    expect(decodeURIComponent(href)).toContain(url);
  });

  it('renders an accessible icon-only control in compact mode (still labelled)', () => {
    render(<WhatsAppShareButton url={url} title={title} compact />);
    // No visible "WhatsApp" text, but the accessible name carries the title.
    expect(screen.queryByText('WhatsApp')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /எங்கள் தேசம்.*பகிர்/ })).toBeInTheDocument();
  });
});
