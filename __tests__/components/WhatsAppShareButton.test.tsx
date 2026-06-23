import { render, screen, fireEvent } from '@testing-library/react';
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

  it('in asButton mode renders a <button> (not an <a>) so it can live inside a card Link', () => {
    render(<WhatsAppShareButton url={url} title={title} asButton />);
    // No nested anchor (would be invalid inside the card's wrapping <Link>).
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /எங்கள் தேசம்.*பகிர்/ })).toBeInTheDocument();
  });

  it('asButton opens WhatsApp and stops the click from following the card link', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(<WhatsAppShareButton url={url} title={title} asButton />);
    const click = fireEvent.click(screen.getByRole('button', { name: /பகிர்/ }));
    // preventDefault() called → the card's wrapping <Link> won't navigate.
    expect(click).toBe(false);
    expect(openSpy).toHaveBeenCalledWith(
      whatsappShareUrl({ title, url, verb: 'listen' }),
      '_blank',
      expect.stringContaining('noopener'),
    );
    openSpy.mockRestore();
  });
});
