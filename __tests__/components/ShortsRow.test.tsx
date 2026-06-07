import { render, screen, fireEvent, within } from '@testing-library/react';
import { ShortsRow } from '@/components/ShortsRow';
import type { ChannelVideo } from '@/lib/youtube-feed';

jest.mock('@/lib/analytics-events', () => ({ trackYouTubeOpen: jest.fn() }));
import { trackYouTubeOpen } from '@/lib/analytics-events';

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

afterEach(() => jest.clearAllMocks());

describe('ShortsRow', () => {
  it('renders nothing when there are no shorts', () => {
    const { container } = render(<ShortsRow shorts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a labelled card with a Short badge per item', () => {
    render(<ShortsRow shorts={[short('s1', 'குறும்படம் ஒன்று')]} />);
    expect(screen.getByRole('button', { name: /Play Short: குறும்படம் ஒன்று/ })).toBeInTheDocument();
    expect(screen.getByText('Short')).toBeInTheDocument();
  });

  it('swaps the thumbnail for an inline (vertical) embed on click', () => {
    render(<ShortsRow shorts={[short(SID, 'Title')]} />);
    fireEvent.click(screen.getByRole('button', { name: /Play Short/ }));
    // the play button is gone; an iframe (the embed) is now present
    expect(screen.queryByRole('button', { name: /Play Short/ })).toBeNull();
    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('src')).toContain('/embed/');
    expect(trackYouTubeOpen).toHaveBeenCalledWith(`video:${SID}`, 'videos_shorts');
  });

  it('keeps a direct YouTube link for each short', () => {
    render(<ShortsRow shorts={[short(SID, 'Title')]} />);
    const item = screen.getByRole('listitem');
    const link = within(item).getByRole('link', { name: /Watch Title on YouTube/ });
    expect(link).toHaveAttribute('href', `https://www.youtube.com/shorts/${SID}`);
  });
});
