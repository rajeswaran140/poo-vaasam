import { render, screen } from '@testing-library/react';
import { PoemCover } from '@/components/PoemCover';

describe('PoemCover', () => {
  it('renders the featured image when one is provided', () => {
    const { container } = render(
      <PoemCover title="அம்மா சொன்ன கதை" featuredImage="https://cdn.example/cover.png" />
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cdn.example/cover.png');
    expect(img?.getAttribute('alt')).toBe('அம்மா சொன்ன கதை');
  });

  it('falls back to a branded title card (no image) when there is no cover', () => {
    const { container } = render(<PoemCover title="அம்மா சொன்ன கதை" />);
    expect(container.querySelector('img')).toBeNull();
    // The title becomes the visible cover, plus the "கவிதை" kicker.
    expect(screen.getByText('அம்மா சொன்ன கதை')).toBeInTheDocument();
    expect(screen.getByText('கவிதை')).toBeInTheDocument();
  });
});
