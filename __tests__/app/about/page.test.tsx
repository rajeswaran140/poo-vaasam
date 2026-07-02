import { render, screen } from '@testing-library/react';

// Force the YouTube CTAs to render so we can assert them; keep the rest of
// config/site real (youtubeSubscribeUrl, socialProfileUrls, liveContentSections…).
jest.mock('@/config/site', () => ({
  ...jest.requireActual('@/config/site'),
  isYouTubeChannelConfigured: jest.fn(() => true),
  isYouTubeVideosConfigured: jest.fn(() => true),
}));

import AboutPage, { metadata } from '@/app/about/page';

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

const allJsonLd = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => s.innerHTML)
    .join('');

describe('About page', () => {
  it('renders the brand H1', () => {
    render(<AboutPage />);
    expect(screen.getByRole('heading', { level: 1, name: /தமிழகவல்/ })).toBeInTheDocument();
  });

  it('names the author in the bio section', () => {
    render(<AboutPage />);
    expect(screen.getAllByText(/இராஜேஸ்வரன் தங்கராஜா/).length).toBeGreaterThan(0);
  });

  it('renders the three content pillars linking to /poems, /songs, /videos', () => {
    render(<AboutPage />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/poems', '/songs', '/videos']));
  });

  it('always offers a contact CTA (ungated)', () => {
    render(<AboutPage />);
    const contact = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/contact');
    expect(contact).toBeDefined();
  });

  it('transparently explains the AI music platform (how the music is made)', () => {
    render(<AboutPage />);
    expect(screen.getByRole('heading', { name: /இசை எப்படி உருவாகிறது/ })).toBeInTheDocument();
    // AI-as-a-tool transparency line, present verbatim.
    expect(screen.getByText(/AI ஒரு கருவி மட்டுமே/)).toBeInTheDocument();
  });

  it('shows the "AI-Assisted Musical Platform" brand descriptor in the hero', () => {
    render(<AboutPage />);
    expect(screen.getByText(/AI-Assisted Musical Platform/i)).toBeInTheDocument();
  });

  it('shows the "Where Tamil Poetry Becomes Song" brand tagline', () => {
    render(<AboutPage />);
    // Appears in both the hero and the shared Footer.
    expect(screen.getAllByText(/Where Tamil Poetry Becomes Song/i).length).toBeGreaterThanOrEqual(1);
  });
});

describe('About page — audit fixes', () => {
  it('renders the shared Footer: copyright byline + owned-audience newsletter capture', () => {
    render(<AboutPage />);
    // Footer was missing entirely before the audit fix.
    expect(screen.getByText(/TechSynergy Corp\. All rights reserved\./)).toBeInTheDocument();
    // The footer carries the email subscribe form (its label).
    expect(screen.getByText(/மின்னஞ்சலில் பெறுங்கள்/)).toBeInTheDocument();
  });

  it('structured data carries BOTH a BreadcrumbList and the Person node', () => {
    const { container } = render(<AboutPage />);
    const ld = allJsonLd(container);
    expect(ld).toContain('BreadcrumbList');
    expect(ld).toContain('"Person"');
    expect(ld).toContain('Rajeswaran Thangarajah');
  });

  it('hero band uses the solid orange brand background (not flat dark)', () => {
    const { container } = render(<AboutPage />);
    expect(container.querySelector('section.bg-orange-600')).not.toBeNull();
  });

  it('hero clears the fixed 80px header — top padding, not py-20 (badge not flush)', () => {
    const { container } = render(<AboutPage />);
    const inner = container.querySelector('section.bg-orange-600 > div');
    // py-20 made the top padding equal the header height → "பற்றி" sat on the
    // header. pt-32 adds clearance below the fixed header.
    expect(inner?.className).toContain('pt-32');
    expect(inner?.className).not.toContain('py-20');
  });
});

describe('About page — metadata', () => {
  it('has a person-focused title for "rajeswaran thangarajah" queries', () => {
    expect(String(metadata.title)).toMatch(/Rajeswaran Thangarajah/);
  });

  it('keeps canonical + openGraph.url aligned on /about', () => {
    expect(metadata.alternates?.canonical).toBe('/about');
    expect(metadata.openGraph?.url).toBe('/about');
  });

  it('declares an openGraph profile type', () => {
    expect(metadata.openGraph?.type).toBe('profile');
  });
});
