/** @jest-environment jsdom */
/**
 * GoogleAnalytics — admin/operator surfaces are never tracked.
 *
 * The 2026-09-12 GA4 audit found 51% of page views were the operator's own
 * /admin and /login sessions. These tests pin the two halves of the fix:
 *
 *   1. gtag.js is not loaded at all when the visit STARTS on an admin path.
 *   2. no page_view is fired while on an admin path.
 *
 * The third case is the subtle one. Once the scripts have mounted they stay
 * mounted, because unmounting and remounting them re-runs `gtag('config')`,
 * which fires its own automatic page_view — and the route-change effect would
 * fire a second one for the same path. `configPathRef` records the path that
 * config already covered so the manual event is skipped exactly once.
 *
 * next/script is mocked to render children inline WITHOUT executing them, so
 * `gtag('config')` never actually runs here; "config owns this page_view" is
 * therefore asserted as the ABSENCE of a manual page_view event.
 */

jest.mock('@/lib/analytics', () => ({
  ...jest.requireActual('@/lib/analytics'),
  isProductionHostForAnalytics: () => true,
}));

let mockPathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('next/script', () => ({
  __esModule: true,
  default: ({ children, src }: { children?: React.ReactNode; src?: string }) => (
    <>{src ? <script data-testid="ga-src" data-src={src} /> : null}{children}</>
  ),
}));

import { render } from '@testing-library/react';
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics';

const pageViews = () =>
  (window.gtag as unknown as jest.Mock).mock.calls.filter((c) => c[0] === 'event' && c[1] === 'page_view');

beforeEach(() => {
  mockPathname = '/';
  (window as unknown as { gtag: jest.Mock }).gtag = jest.fn();
});

it('loads no gtag scripts when the visit starts on an admin path', () => {
  mockPathname = '/admin/mastering';
  const { container } = render(<GoogleAnalytics gaId="G-TEST" />);
  expect(container.innerHTML).toBe('');
  expect(pageViews()).toHaveLength(0);
});

it('loads no gtag scripts when the visit starts on /login', () => {
  mockPathname = '/login';
  const { container } = render(<GoogleAnalytics gaId="G-TEST" />);
  expect(container.innerHTML).toBe('');
});

it('still loads on an ordinary public path', () => {
  mockPathname = '/songs';
  const { container } = render(<GoogleAnalytics gaId="G-TEST" />);
  expect(container.innerHTML).not.toBe('');
});

it('fires no page_view when navigating from a public page INTO admin', () => {
  const { rerender } = render(<GoogleAnalytics gaId="G-TEST" />);
  (window.gtag as unknown as jest.Mock).mockClear();

  mockPathname = '/admin/lexicon';
  rerender(<GoogleAnalytics gaId="G-TEST" />);

  expect(pageViews()).toHaveLength(0);
});

it('does not double-count when the scripts first mount after leaving admin', () => {
  // Start on admin: nothing loads, nothing fires.
  mockPathname = '/admin';
  const { rerender } = render(<GoogleAnalytics gaId="G-TEST" />);
  expect(pageViews()).toHaveLength(0);

  // Move to a public page: the scripts mount NOW, so gtag('config') sends the
  // page_view for /songs. The effect must not send a second one.
  mockPathname = '/songs';
  rerender(<GoogleAnalytics gaId="G-TEST" />);
  expect(pageViews()).toHaveLength(0);
});

it('resumes firing page_views on public navigation after an admin detour', () => {
  // One continuous visit: '/' (config owns it) → '/admin' (silent) → '/about'.
  const { rerender } = render(<GoogleAnalytics gaId="G-TEST" />);

  mockPathname = '/admin';
  rerender(<GoogleAnalytics gaId="G-TEST" />);
  (window.gtag as unknown as jest.Mock).mockClear();

  mockPathname = '/about';
  rerender(<GoogleAnalytics gaId="G-TEST" />);

  expect(pageViews()).toHaveLength(1);
});
