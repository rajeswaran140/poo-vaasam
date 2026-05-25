import { render } from '@testing-library/react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';

describe('YouTubeEmbed', () => {
  it('renders an iframe pointing at the embed URL for a valid YouTube link', () => {
    const { container } = render(
      <YouTubeEmbed url="https://youtu.be/dQw4w9WgXcQ" title="Sample" />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(iframe?.getAttribute('title')).toBe('Sample');
    expect(iframe?.getAttribute('allowfullscreen')).not.toBeNull();
  });

  it('renders nothing for a non-YouTube URL', () => {
    const { container } = render(<YouTubeEmbed url="https://example.com/song.mp3" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
