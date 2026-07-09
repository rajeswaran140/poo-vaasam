import { render } from '@testing-library/react';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';

describe('YouTubeEmbed', () => {
  it('renders an iframe pointing at the embed URL for a valid YouTube link', () => {
    const { container } = render(
      <YouTubeEmbed url="https://youtu.be/dQw4w9WgXcQ" title="Sample" />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const src = iframe?.getAttribute('src') ?? '';
    expect(src).toContain('https://www.youtube.com/embed/dQw4w9WgXcQ');
    // rel=0 keeps the end-screen on our channel (no third-party redirect)
    expect(src).toContain('rel=0');
    expect(iframe?.getAttribute('title')).toBe('Sample');
    expect(iframe?.getAttribute('allowfullscreen')).not.toBeNull();
  });

  it('plays within the given playlist so the song continues to the next one', () => {
    const { container } = render(
      <YouTubeEmbed url="https://youtu.be/dQw4w9WgXcQ" playlist="PLabc123" />
    );
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('list=PLabc123');
  });

  it('renders nothing for a non-YouTube URL', () => {
    const { container } = render(<YouTubeEmbed url="https://example.com/song.mp3" />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
