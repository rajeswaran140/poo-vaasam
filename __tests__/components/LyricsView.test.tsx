/**
 * LyricsView — renders structured lyrics (sections → lines) with labels and
 * optional romanisation, the on-site half of the lyrics-as-data unlock.
 */

import { render, screen } from '@testing-library/react';
import { LyricsView } from '@/components/LyricsView';
import type { LyricsDTO } from '@/domain/songs/Lyrics';

const sections: LyricsDTO['sections'] = [
  { kind: 'pallavi', label: 'பல்லவி', lines: [{ text: 'நீ சிரிச்ச நேரம்', romanized: 'nee siricha neram' }] },
  { kind: 'charanam', lines: [{ text: 'வரி ஒன்று' }, { text: 'வரி இரண்டு' }] },
];

describe('LyricsView', () => {
  it('renders every line of every section', () => {
    render(<LyricsView sections={sections} />);
    expect(screen.getByText('நீ சிரிச்ச நேரம்')).toBeInTheDocument();
    expect(screen.getByText('வரி ஒன்று')).toBeInTheDocument();
    expect(screen.getByText('வரி இரண்டு')).toBeInTheDocument();
  });

  it('shows the authored label, and a Tamil default for an unlabelled known kind', () => {
    render(<LyricsView sections={sections} />);
    expect(screen.getByText('பல்லவி')).toBeInTheDocument(); // authored
    expect(screen.getByText('சரணம்')).toBeInTheDocument(); // default for charanam
  });

  it('renders romanisation when present', () => {
    render(<LyricsView sections={sections} />);
    expect(screen.getByText('nee siricha neram')).toBeInTheDocument();
  });

  it('renders no label for an unlabelled "other" section', () => {
    const { container } = render(
      <LyricsView sections={[{ kind: 'other', lines: [{ text: 'just a line' }] }]} />
    );
    expect(screen.getByText('just a line')).toBeInTheDocument();
    expect(container.querySelector('h3')).toBeNull();
  });

  it('renders nothing for empty input', () => {
    const { container } = render(<LyricsView sections={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
