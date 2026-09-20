/**
 * The Shorts catalogue grid, and the constraint Raj set for it on 2026-09-20:
 * *"These shorts must exclusively feature content sourced from 'tamilagaval'
 * and no other material."*
 *
 * The teeth of that are in the embed URL. `rel=0` keeps YouTube's end-screen
 * suggestions on this channel, and `list=<our Shorts playlist>` makes the next
 * thing that plays one of ours rather than a suggestion at all. Songs already
 * chained into the All Songs playlist; **Shorts passed no playlist**, which is
 * the gap these tests close and pin.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortsGrid } from '@/components/ShortsGrid';
import { ShortsRow } from '@/components/ShortsRow';
import { SITE } from '@/config/site';
import type { ChannelVideo } from '@/lib/youtube-feed';

jest.mock('@/lib/analytics-events', () => ({ trackYouTubeOpen: jest.fn() }));

// 11-char IDs — getYouTubeId (and thus the embed URL) requires a real video ID.
const short = (id: string, title: string): ChannelVideo => ({
  id,
  title,
  description: '',
  publishedAt: '2026-06-07T00:00:00Z',
  thumbnail: `https://cdn/${id}.jpg`,
  watchUrl: `https://www.youtube.com/shorts/${id}`,
});
const SID = 's9mRAyfxrSQ';
const SID2 = 'wPxNf0VKUKQ';

describe('ShortsGrid', () => {
  it('shows every short rather than hiding them behind a swipe', () => {
    render(<ShortsGrid shorts={[short(SID, 'ஒன்று'), short(SID2, 'இரண்டு')]} />);
    expect(screen.getByRole('button', { name: /Play Short: ஒன்று/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Play Short: இரண்டு/ })).toBeInTheDocument();
  });

  it('says so in Tamil when there is nothing to show, rather than rendering an empty page', () => {
    render(<ShortsGrid shorts={[]} />);
    expect(screen.getByText(/ஷார்ட்ஸ் எதுவும் இல்லை/)).toBeInTheDocument();
  });

  it('swaps a card for an inline vertical embed on click', () => {
    render(<ShortsGrid shorts={[short(SID, 'Title')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Play Short/ }));
    expect(screen.queryByRole('button', { name: /Play Short/ })).toBeNull();
    expect(document.querySelector('iframe')!.getAttribute('src')).toContain('/embed/');
  });

  it('plays one at a time, so a second click moves the player', () => {
    render(<ShortsGrid shorts={[short(SID, 'ஒன்று'), short(SID2, 'இரண்டு')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Play Short: ஒன்று/ }));
    fireEvent.click(screen.getByRole('button', { name: /Play Short: இரண்டு/ }));
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Play Short: ஒன்று/ })).toBeInTheDocument();
  });
});

/**
 * ⚠️ THE SOURCING CONSTRAINT. Both surfaces show the same videos, so both must
 * chain into our own playlist — a viewer must never be handed to another
 * channel by a Tamilagaval page.
 */
describe.each([
  ['ShortsGrid', ShortsGrid],
  ['ShortsRow', ShortsRow],
])('%s keeps the viewer on Tamilagaval', (_name, Component) => {
  const play = () => {
    render(<Component shorts={[short(SID, 'Title')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Play Short/ }));
    return document.querySelector('iframe')!.getAttribute('src')!;
  };

  it('chains into OUR Shorts playlist, not YouTube-s suggestions', () => {
    expect(play()).toContain(`list=${SITE.youtube.shortsPlaylistId}`);
  });

  it('suppresses cross-channel related videos', () => {
    expect(play()).toContain('rel=0');
  });

  it('uses the Shorts playlist, never the All Songs one', () => {
    const src = play();
    expect(src).not.toContain(SITE.youtube.allSongsPlaylistId);
  });
});
