/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { FeaturedSongs } from '@/components/FeaturedSongs';
import { FEATURED_SONGS } from '@/config/featured-songs';

describe('FeaturedSongs rail', () => {
  it('renders a card per featured song, each linking to its YouTube watch page', () => {
    render(<FeaturedSongs />);
    FEATURED_SONGS.forEach((s) => expect(screen.getByText(s.title)).toBeInTheDocument());
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://www.youtube.com/watch?v=GXLu3Y7FghU');
    expect(hrefs).toContain('https://www.youtube.com/watch?v=KtFF0CCnCY4');
  });

  it('shows an on-site "details" link ONLY for a song that has a content page', () => {
    render(<FeaturedSongs />);
    const details = screen.getAllByText('விவரங்கள் →');
    expect(details).toHaveLength(1); // only நீ சிரிச்ச has contentId
    expect(details[0].closest('a')?.getAttribute('href')).toBe('/content/cnt_1783474963836_iknup2zv0');
  });

  it('shows the /popular link only when showAllLink is set', () => {
    const { rerender } = render(<FeaturedSongs />);
    expect(screen.queryByText(/எல்லாம் பார்க்க/)).not.toBeInTheDocument();
    rerender(<FeaturedSongs showAllLink />);
    expect(screen.getByText(/எல்லாம் பார்க்க/).closest('a')?.getAttribute('href')).toBe('/popular');
  });
});
