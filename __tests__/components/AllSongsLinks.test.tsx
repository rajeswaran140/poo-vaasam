/**
 * Tests for AllSongsLinks — the always-SSR internal-link list that puts a
 * crawlable <a> for every published song into the /videos HTML (independent of
 * the gallery's client-side "Load more" pagination).
 */

import { render, screen } from '@testing-library/react';
import { AllSongsLinks, type SongLink } from '@/components/AllSongsLinks';

const songs: SongLink[] = [
  { title: 'காதோட ஆடும் லோலாக்கு', href: '/content/cnt_1' },
  { title: 'அந்தி மேகமே', href: '/content/cnt_2' },
  { title: 'என் மன்னவனே', href: '/content/cnt_3' },
];

describe('AllSongsLinks', () => {
  it('renders one internal /content link per song, with the Tamil title as anchor text', () => {
    render(<AllSongsLinks songs={songs} />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    // Every link is an internal /content path (not YouTube), keyed to the song.
    expect(screen.getByRole('link', { name: 'காதோட ஆடும் லோலாக்கு' })).toHaveAttribute('href', '/content/cnt_1');
    expect(screen.getByRole('link', { name: 'என் மன்னவனே' })).toHaveAttribute('href', '/content/cnt_3');
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^\/content\//);
    }
  });

  it('renders a labelled section heading', () => {
    render(<AllSongsLinks songs={songs} />);
    // Accessible section named by its heading.
    expect(screen.getByRole('region', { name: /All songs/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /All songs/i })).toBeInTheDocument();
  });

  it('renders nothing when there are no songs (no empty shell)', () => {
    const { container } = render(<AllSongsLinks songs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
