/**
 * SubscribeButton — a11y: the link must have a descriptive accessible name
 * ("Subscribe on YouTube"), not just the visible "YouTube" label.
 */

import { render, screen } from '@testing-library/react';
import { SubscribeButton } from '@/components/SubscribeButton';

jest.mock('@/lib/analytics-events', () => ({ trackSubscribeClick: jest.fn() }));

describe('SubscribeButton', () => {
  it('exposes a descriptive accessible name via aria-label', () => {
    render(<SubscribeButton source="videos_hero" />);
    const link = screen.getByRole('link', { name: 'Subscribe on YouTube' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.getAttribute('href')).toMatch(/youtube\.com/);
  });

  it('keeps the visible label independent of the accessible name', () => {
    render(<SubscribeButton label="YouTube" source="x" />);
    // aria-label wins for the accessible name; the visible text is still there.
    expect(screen.getByRole('link', { name: 'Subscribe on YouTube' })).toHaveTextContent('YouTube');
  });
});
