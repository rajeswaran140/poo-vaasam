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

  it('has order CTAs that link to the contact form with a prefilled subject', () => {
    render(<MusicCompositionPage />);
    const links = screen.getAllByRole('link');
    const orderLink = links.find(
      (a) => a.getAttribute('href') === '/contact?subject=Music%20Composition%20Request'
    );
    expect(orderLink).toBeDefined();
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
});

describe('Music Composition page — audit fixes', () => {
  it('renders the shared Footer at the bottom (carries the TechSynergy Corp byline)', () => {
    render(<MusicCompositionPage />);
    expect(screen.getByText(/TechSynergy Corp\. All rights reserved\./)).toBeInTheDocument();
  });

  it('YouTube channel fallback uses a tracked subscribe anchor', () => {
    render(<MusicCompositionPage />);
    // Both the samples fallback AND the Footer expose aria-label="YouTube";
    // the samples link carries the music_composition_samples source on its
    // UTM, which lets us pick it out specifically.
    const samplesYt = screen
      .getAllByLabelText('YouTube')
      .find((a) => a.getAttribute('href')?.includes('music_composition_samples'));
    expect(samplesYt).toBeDefined();
    expect(samplesYt!.getAttribute('href')).toMatch(/sub_confirmation=1/);
    expect(samplesYt!.getAttribute('target')).toBe('_blank');
    expect(samplesYt!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('final CTA card uses the orange brand gradient, not purple', () => {
    const { container } = render(<MusicCompositionPage />);
    expect(container.querySelector('[class*="from-purple-"]')).toBeNull();
    expect(container.querySelector('[class*="to-purple-"]')).toBeNull();
    expect(container.querySelector('[class*="from-orange-500"]')).not.toBeNull();
  });
});
