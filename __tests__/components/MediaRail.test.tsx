import { render, screen, within } from '@testing-library/react';
import { MediaRail } from '@/components/MediaRail';

describe('MediaRail', () => {
  it('renders children inside a labelled scroll list', () => {
    render(
      <MediaRail label="Shorts">
        <li>One</li>
        <li>Two</li>
      </MediaRail>
    );
    const list = screen.getByRole('list', { name: 'Shorts' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('provides prev/next scroll controls (Tamil labels)', () => {
    render(<MediaRail label="Rail"><li>A</li></MediaRail>);
    expect(screen.getByRole('button', { name: 'முந்தைய' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'அடுத்தது' })).toBeInTheDocument();
  });
});
