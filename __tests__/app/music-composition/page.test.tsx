import { render, screen } from '@testing-library/react';
import MusicCompositionPage, { metadata } from '@/app/music-composition/page';

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
});

describe('Music Composition page', () => {
  it('renders the H1 service heading', () => {
    render(<MusicCompositionPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /இசையமைப்பு சேவை/ })
    ).toBeInTheDocument();
  });

  it('order CTAs scroll to the on-page commission form (a real funnel, not a blank /contact)', () => {
    render(<MusicCompositionPage />);
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '#request')).toBe(true);
    // CTAs no longer hand off to the blank /contact?subject= flow
    expect(links.some((a) => a.getAttribute('href')?.includes('subject=Music'))).toBe(false);
  });

  it('renders the structured commission request form', () => {
    render(<MusicCompositionPage />);
    expect(screen.getByLabelText(/Lyrics \/ details/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send request/i })).toBeInTheDocument();
  });

  it('renders FAQ questions', () => {
    render(<MusicCompositionPage />);
    expect(screen.getByText('விலை எவ்வளவு?')).toBeInTheDocument();
    expect(screen.getByText(/எப்படி ஆர்டர்/)).toBeInTheDocument();
  });
});

describe('Music Composition page — metadata', () => {
  it('exposes openGraph.url so social shares normalize on the canonical URL', () => {
    expect(metadata.openGraph?.url).toBe('/music-composition');
  });

  it('declares siteName + Tamil locale on openGraph', () => {
    expect(metadata.openGraph?.siteName).toBeTruthy();
    expect(metadata.openGraph?.locale).toBe('ta_IN');
  });

  it('keeps canonical aligned with openGraph.url', () => {
    expect(metadata.alternates?.canonical).toBe('/music-composition');
  });

  it('has a bilingual title for English search reach', () => {
    expect(String(metadata.title)).toMatch(/Tamil Music Composition/);
  });
});

describe('Music Composition page — audit fixes', () => {
  it('renders the shared Footer at the bottom (carries the TechSynergy Corp byline)', () => {
    render(<MusicCompositionPage />);
    expect(screen.getByText(/TechSynergy Corp\. All rights reserved\./)).toBeInTheDocument();
  });

  it('embeds verified full-song samples (configured), not the channel fallback', () => {
    const { container } = render(<MusicCompositionPage />);
    // Samples are configured now, so the embeds render…
    expect(container.querySelectorAll('iframe').length).toBeGreaterThanOrEqual(3);
    // …and the empty-state "listen on our channel" subscribe link is gone.
    const fallback = screen
      .queryAllByLabelText('YouTube')
      .find((a) => a.getAttribute('href')?.includes('music_composition_samples'));
    expect(fallback).toBeUndefined();
  });

  it('no longer claims human "artists" (கலைஞர்) — AI-assisted framing (honesty)', () => {
    render(<MusicCompositionPage />);
    expect(screen.queryByText(/கலைஞர்/)).toBeNull();
  });

  it('structured data carries a BreadcrumbList and no priceless Offer', () => {
    const { container } = render(<MusicCompositionPage />);
    const ld = container.querySelector('script[type="application/ld+json"]')?.innerHTML || '';
    expect(ld).toContain('BreadcrumbList');
    expect(ld).toContain('FAQPage');
    expect(ld).not.toContain('Offer');
  });

  it('final CTA card uses the solid orange brand, not purple or a gradient', () => {
    const { container } = render(<MusicCompositionPage />);
    expect(container.querySelector('[class*="from-purple-"]')).toBeNull();
    expect(container.querySelector('[class*="to-purple-"]')).toBeNull();
    // Brand gradient was flattened to solid orange site-wide.
    expect(container.querySelector('[class*="from-orange-500"]')).toBeNull();
    expect(container.querySelector('[class*="bg-orange-600"]')).not.toBeNull();
  });
});
