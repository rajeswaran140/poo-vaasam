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

  it('structured data carries a BreadcrumbList, FAQPage and a priced AggregateOffer', () => {
    const { container } = render(<MusicCompositionPage />);
    const ld = container.querySelector('script[type="application/ld+json"]')?.innerHTML || '';
    expect(ld).toContain('BreadcrumbList');
    expect(ld).toContain('FAQPage');
    // The visible card shows a "starting from" floor, so the Service Offer must
    // publish that same price (as an AggregateOffer.lowPrice) — not be omitted.
    expect(ld).toContain('AggregateOffer');
    expect(ld).toMatch(/"lowPrice":\s*75/);
    expect(ld).toContain('"priceCurrency":"CAD"');
    // …and it must not regress to a priceless Offer (Rich Results flags those).
    expect(ld).not.toMatch(/"@type":"Offer"/);
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

describe('Music Composition page — pricing consistency (audit fix #1)', () => {
  // Regression: the visible card showed "CAD $75 / 5–7 working days" while the
  // Service schema had no Offer and the FAQ answers stayed vague. Card, schema,
  // and FAQ must all quote the same figures so Google's rich result matches.

  it('shows the starting price and turnaround on the visible pricing card', () => {
    render(<MusicCompositionPage />);
    expect(screen.getAllByText(/CAD \$75/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/working days/i).length).toBeGreaterThan(0);
  });

  it('FAQ price answer names the concrete starting figure, not just "free quote"', () => {
    render(<MusicCompositionPage />);
    // CAD $75 now appears on BOTH the pricing card and the FAQ answer paragraph.
    expect(screen.getAllByText(/CAD \$75/).length).toBeGreaterThanOrEqual(2);
  });

  it('FAQ turnaround answer names the 5–7 day window', () => {
    render(<MusicCompositionPage />);
    expect(screen.getByText(/5–7 வேலை நாட்கள்/)).toBeInTheDocument();
  });

  it('FAQPage structured data echoes the price shown on the page', () => {
    const { container } = render(<MusicCompositionPage />);
    const ld = container.querySelector('script[type="application/ld+json"]')?.innerHTML || '';
    const parsed = JSON.parse(ld) as Array<Record<string, unknown>>;
    const faq = parsed.find((n) => n['@type'] === 'FAQPage') as {
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    const priceQ = faq.mainEntity.find((q) => q.name === 'விலை எவ்வளவு?');
    expect(priceQ?.acceptedAnswer.text).toMatch(/CAD \$75/);
  });

  it('Service structured data publishes the same price floor as an AggregateOffer', () => {
    const { container } = render(<MusicCompositionPage />);
    const ld = container.querySelector('script[type="application/ld+json"]')?.innerHTML || '';
    const parsed = JSON.parse(ld) as Array<Record<string, unknown>>;
    const service = parsed.find((n) => n['@type'] === 'Service') as {
      offers?: { '@type': string; lowPrice: number; priceCurrency: string };
    };
    expect(service.offers?.['@type']).toBe('AggregateOffer');
    expect(service.offers?.lowPrice).toBe(75);
    expect(service.offers?.priceCurrency).toBe('CAD');
  });
});
