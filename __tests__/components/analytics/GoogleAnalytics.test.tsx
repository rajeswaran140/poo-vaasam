/** @jest-environment jsdom */
/**
 * GoogleAnalytics — SPA page_view behaviour (audit fix).
 * gtag('config') owns the initial page_view; the component fires a manual
 * page_view ONLY on subsequent route changes (no double-count, no UA page_path).
 */

let mockPathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
// Render next/script children inline (the GA init script string) without executing it.
jest.mock('next/script', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { render } from '@testing-library/react';
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics';

declare global {
   
  var gtag: jest.Mock | undefined;
}

beforeEach(() => {
  mockPathname = '/';
  (window as unknown as { gtag: jest.Mock }).gtag = jest.fn();
});

it('renders nothing when no gaId is configured', () => {
  const { container } = render(<GoogleAnalytics gaId="" />);
  expect(container.innerHTML).toBe('');
});

it('does NOT fire a manual page_view on initial mount (config owns the first one)', () => {
  render(<GoogleAnalytics gaId="G-TEST" />);
  const calls = (window.gtag as jest.Mock).mock.calls.filter((c) => c[1] === 'page_view');
  expect(calls).toHaveLength(0);
});

it('fires a page_view on a subsequent route change — page_location + page_title, no page_path', () => {
  const { rerender } = render(<GoogleAnalytics gaId="G-TEST" />);
  (window.gtag as jest.Mock).mockClear();

  mockPathname = '/songs';
  rerender(<GoogleAnalytics gaId="G-TEST" />);

  const call = (window.gtag as jest.Mock).mock.calls.find((c) => c[0] === 'event' && c[1] === 'page_view');
  expect(call).toBeTruthy();
  expect(call![2]).toEqual(
    expect.objectContaining({ page_location: expect.any(String), page_title: expect.any(String) })
  );
  expect(call![2]).not.toHaveProperty('page_path'); // UA-style param dropped
});
