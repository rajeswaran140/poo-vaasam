jest.mock('next/navigation', () => ({ usePathname: () => '/songs' }));

import { render, screen, fireEvent } from '@testing-library/react';
import Header from '@/components/Header';

afterEach(() => {
  document.body.style.overflow = '';
});

describe('Header — mobile menu', () => {
  it('toggles the mobile menu open and closed', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('#mobile-menu')).toBeNull();

    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(container.querySelector('#mobile-menu')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(container.querySelector('#mobile-menu')).toBeNull();
  });

  it('locks background scroll while open and restores it on close', () => {
    render(<Header />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByLabelText('Close menu'));
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape', () => {
    const { container } = render(<Header />);
    fireEvent.click(screen.getByLabelText('Open menu'));
    expect(container.querySelector('#mobile-menu')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('#mobile-menu')).toBeNull();
  });
});

describe('Header — skip link', () => {
  it('renders a skip-to-content link targeting #main, hidden until focused', () => {
    render(<Header />);
    const skip = screen.getByRole('link', { name: 'உள்ளடக்கத்திற்கு செல்' });
    expect(skip).toHaveAttribute('href', '#main');
    expect(skip).toHaveClass('sr-only');           // visually hidden by default
    expect(skip.className).toContain('focus:not-sr-only'); // revealed on focus
  });

  it('is the first focusable element in the header (before the nav)', () => {
    const { container } = render(<Header />);
    const focusables = container.querySelectorAll('a[href], button');
    expect(focusables[0]).toHaveAttribute('href', '#main');
  });
});

describe('Header — navigation', () => {
  it('marks the current route as active (aria-current)', () => {
    render(<Header />);
    const songLinks = screen.getAllByRole('link', { name: 'பாடல்கள்' });
    expect(songLinks.some((a) => a.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('groups content types under the படைப்புகள் dropdown trigger', () => {
    render(<Header />);
    expect(screen.getByRole('button', { name: /படைப்புகள்/ })).toBeInTheDocument();
  });

  it('surfaces the live sections (songs, poems) and hides empty ones (stories, essays)', () => {
    render(<Header />);
    expect(screen.getAllByRole('link', { name: 'பாடல்கள்' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'கவிதைகள்' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'கதைகள்' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'கட்டுரைகள்' })).toBeNull();
  });

  it('surfaces the gated lyrics section (grouped under படைப்புகள்)', () => {
    render(<Header />);
    // The gated /lyrics hub is a distinct destination (email-unlock), not a
    // CONTENT_SECTIONS browse item — it appears (under the படைப்புகள் dropdown)
    // even though the LYRICS content section is still flagged not-live.
    const links = screen.getAllByRole('link', { name: 'பாடல் வரிகள்' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/lyrics');
  });
});

describe('Header — 4-item grouped structure', () => {
  const href = (name: string) =>
    screen.getAllByRole('link', { name })[0]?.getAttribute('href');

  it('has exactly two dropdown groups (படைப்புகள் + சமூகம்) and two plain links', () => {
    render(<Header />);
    // Two group triggers.
    expect(screen.getByRole('button', { name: /படைப்புகள்/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /சமூகம்/ })).toBeInTheDocument();
    // The only nav <button>s are the two dropdown triggers + the mobile toggle.
    const navButtons = screen.getAllByRole('button').filter((b) => /படைப்புகள்|சமூகம்/.test(b.textContent || ''));
    expect(navButtons).toHaveLength(2);
  });

  it('groups community destinations (share / support / status) under சமூகம்', () => {
    render(<Header />);
    expect(href('உங்கள் கதை')).toBe('/share');
    expect(href('ஆதரவு')).toBe('/support');
  });

  it('surfaces the composition service and the About page as top-level links', () => {
    render(<Header />);
    expect(href('இசையமைப்பு')).toBe('/music-composition');
    expect(href('பற்றி')).toBe('/about');
  });
});
