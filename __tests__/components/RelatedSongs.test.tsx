import { render, screen } from '@testing-library/react';
import { RelatedSongs } from '@/components/RelatedSongs';
import type { RelatedSongItem } from '@/lib/related-songs';

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, string>)} />,
}));

const items: RelatedSongItem[] = [
  { title: 'அந்தி மேகமே', href: '/content/a', coverUrl: 'https://i.ytimg.com/vi/x/hq.jpg', artist: 'இராஜ்' },
  { title: 'என் மன்னவனே', href: '/content/b' },
];

describe('RelatedSongs', () => {
  it('renders an internal link per song with the title as anchor text', () => {
    render(<RelatedSongs songs={items} />);
    expect(screen.getByRole('link', { name: /அந்தி மேகமே/ })).toHaveAttribute('href', '/content/a');
    expect(screen.getByRole('link', { name: /என் மன்னவனே/ })).toHaveAttribute('href', '/content/b');
  });

  it('shows a cover image when present and a placeholder otherwise', () => {
    render(<RelatedSongs songs={items} />);
    expect(screen.getByAltText('அந்தி மேகமே')).toBeInTheDocument();
    expect(screen.getByText('🎵')).toBeInTheDocument(); // the song with no coverUrl
  });

  it('renders nothing when there are no related songs', () => {
    const { container } = render(<RelatedSongs songs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
