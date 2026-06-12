/**
 * Tests for the shared Footer — brand, social, links, copyright.
 *
 * NOTE: Footer is a server component but consumes only synchronous helpers
 * (site config + TrackedYouTubeAnchor client component), so React Testing
 * Library can render it directly.
 */

import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/Footer';

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

describe('Footer', () => {
  it('renders the brand block (heading + tagline)', () => {
    render(<Footer />);
    expect(screen.getByRole('heading', { level: 3, name: 'தமிழகவல்' })).toBeInTheDocument();
    expect(screen.getByText(/கவிதைகள்.*பாடல்கள்.*காணொளிகள்/)).toBeInTheDocument();
  });

  it('renders both nav columns with their headings', () => {
    render(<Footer />);
    expect(screen.getByRole('heading', { level: 4, name: 'விரைவு இணைப்புகள்' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'பற்றி' })).toBeInTheDocument();
  });

  it('renders core about-section links', () => {
    render(<Footer />);
    expect(screen.getByRole('link', { name: 'எங்களை பற்றி' })).toHaveAttribute('href', '/about');
    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
  });

  it('routes the contact link to the internal /contact page', () => {
    render(<Footer />);
    const contact = screen.getByRole('link', { name: 'தொடர்பு' });
    expect(contact).toHaveAttribute('href', '/contact');
    // internal nav — not an external new-tab link
    expect(contact).not.toHaveAttribute('target');
  });

  it('renders the dynamic-year copyright with the TechSynergy Corp byline', () => {
    render(<Footer />);
    const year = new Date().getFullYear();
    expect(screen.getByText(new RegExp(`© ${year} TechSynergy Corp\\. All rights reserved\\.`))).toBeInTheDocument();
  });

  it('exposes a YouTube social link when the channel is configured', () => {
    render(<Footer />);
    // The TrackedYouTubeAnchor renders an <a aria-label="YouTube">; verify it
    // points at the subscribe URL (uses ?sub_confirmation=1).
    const yt = screen.getByLabelText('YouTube');
    expect(yt.getAttribute('href')).toMatch(/sub_confirmation=1/);
  });
});
