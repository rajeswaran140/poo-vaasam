/**
 * ViewTracker fires the view beacon once per session per content id, and
 * swallows failures.
 */

import { render } from '@testing-library/react';
import { ViewTracker } from '@/components/ViewTracker';

describe('ViewTracker', () => {
  beforeEach(() => {
    sessionStorage.clear();
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  it('POSTs the beacon for the content id on mount', () => {
    render(<ViewTracker contentId="cnt_abc" />);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('/api/content/cnt_abc/view');
    expect(opts).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('does not fire again for the same id within the session (sessionStorage dedupe)', () => {
    const { unmount } = render(<ViewTracker contentId="cnt_abc" />);
    unmount();
    render(<ViewTracker contentId="cnt_abc" />);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('fires separately for a different content id', () => {
    render(<ViewTracker contentId="cnt_one" />);
    render(<ViewTracker contentId="cnt_two" />);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does nothing when contentId is empty', () => {
    render(<ViewTracker contentId="" />);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('swallows a rejected beacon without throwing', () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
    expect(() => render(<ViewTracker contentId="cnt_x" />)).not.toThrow();
  });
});
