import { render, screen, within } from '@testing-library/react';
import { KaraokeRequestForm } from '@/components/KaraokeRequestForm';
import { metadata } from '@/app/karaoke/page';
import KaraokePage from '@/app/karaoke/page';
import { adsAllowedOn } from '@/lib/adsense';
import { KARAOKE_PRICE_LABEL } from '@/lib/karaoke';
import { SITE_NAME } from '@/lib/seo';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

beforeEach(() => {
  (window as unknown as { gtag?: () => void }).gtag = jest.fn();
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
});

describe('Karaoke page — metadata', () => {
  it('exposes openGraph.url so social shares normalize on the canonical URL', () => {
    expect(metadata.openGraph?.url).toBe('/karaoke');
  });

  it('is indexable — this page is meant to be found', () => {
    expect(metadata.robots).toBeUndefined();
  });

  /**
   * ⚠️ AUDIT 2026-09-25: the live tab read
   * "கராஓகே சேவை · Tamil Karaoke Tracks | Tamilagaval | Tamilagaval" — the only
   * page on the site doing that. The ROOT layout already appends the brand via
   * `title: { template: '%s | Tamilagaval' }`, so a page that bakes the brand
   * into its own top-level title gets a second one. /music-composition is the
   * worked example: bare at the top level, brand only inside openGraph/twitter,
   * where no template applies.
   */
  it('leaves the brand to the root template instead of baking in a second copy', () => {
    expect(typeof metadata.title).toBe('string');
    const occurrences = String(metadata.title).split(SITE_NAME).length - 1;
    expect(occurrences).toBe(0);
  });

  /**
   * ⚠️ AUDIT 2026-09-25: /karaoke was the ONLY route on the site serving no
   * og:image at all. Declaring an `openGraph` block REPLACES the root's
   * wholesale, and this one carries no `images` — /contact keeps the site card
   * precisely because it declares no openGraph. The repo's fix everywhere else
   * is a co-located opengraph-image.tsx, and content-metadata.test.ts records
   * why it matters: WhatsApp's scraper is the consumer, and this is the page
   * that gets sold over WhatsApp.
   */
  it('ships a co-located share card, since its openGraph block overrides the root one', () => {
    expect(metadata.openGraph?.images).toBeUndefined();
    expect(existsSync(join(process.cwd(), 'src/app/karaoke/opengraph-image.tsx'))).toBe(true);
  });
});

describe('Karaoke page — a paid service page carries no ads', () => {
  it('excludes /karaoke, as /music-composition already is', () => {
    // An ad beside a price undercuts the page's purpose.
    expect(adsAllowedOn('/karaoke')).toBe(false);
    expect(adsAllowedOn('/music-composition')).toBe(false);
  });
});

describe('KaraokeRequestForm — the brief is four fields, not a composition brief', () => {
  it('asks only what a karaoke order needs', () => {
    render(<KaraokeRequestForm songs={['செவ்வந்தி பூவே']} />);
    expect(screen.getByLabelText(/Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Which song/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Notes/i)).toBeInTheDocument();
  });

  it('does NOT ask the composition questions, which have no meaning here', () => {
    render(<KaraokeRequestForm songs={[]} />);
    expect(screen.queryByLabelText(/Occasion/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Mood/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Lyrics/i)).not.toBeInTheDocument();
  });

  it('offers the catalogue as a picker when songs are available', () => {
    render(<KaraokeRequestForm songs={['செவ்வந்தி பூவே', 'ஆத்தோர மண் வாசம்']} />);
    const select = screen.getByLabelText(/Which song/i);
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'ஆத்தோர மண் வாசம்' })).toBeInTheDocument();
  });

  it('falls back to free text when the catalogue is empty — never a broken empty dropdown', () => {
    render(<KaraokeRequestForm songs={[]} />);
    expect(screen.getByLabelText(/Which song/i).tagName).toBe('INPUT');
  });

  it('shows the price and that payment follows confirmation, not precedes it', () => {
    render(<KaraokeRequestForm songs={[]} />);
    expect(screen.getByText(new RegExp(KARAOKE_PRICE_LABEL.replace('$', '\\$')))).toBeInTheDocument();
    expect(screen.getByText(/Payment link sent after we confirm/i)).toBeInTheDocument();
  });

  it('carries a honeypot field, hidden from real users', () => {
    const { container } = render(<KaraokeRequestForm songs={[]} />);
    expect(container.querySelector('input.hidden[aria-hidden]')).toBeTruthy();
  });
});


describe('Karaoke page — tap targets a thumb can actually hit', () => {
  it('the /music-composition cross-link carries a 44px minimum height', async () => {
    // A mobile audit on 2026-09-16 measured it at 186x20 as an inline link
    // inside a sentence. 20px is half what a thumb needs, and the fix is easy
    // to undo by accident — someone tidying the markup back into one sentence
    // would reintroduce it silently. min-h-11 is Tailwind's 44px.
    const ui = await KaraokePage();
    const { container } = render(ui);
    // Scoped to <main>: the Footer carries the same link text site-wide, and
    // this assertion is about the in-page one the audit measured.
    const main = container.querySelector('main');
    expect(main).toBeTruthy();
    const link = within(main as HTMLElement).getByRole('link', { name: /இசையமைப்பு சேவை/ });
    expect(link.className).toMatch(/min-h-11/);
    expect(link.className).toMatch(/inline-flex/);
  });
});
