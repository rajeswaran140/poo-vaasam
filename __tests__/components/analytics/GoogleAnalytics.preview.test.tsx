/** @jest-environment jsdom */
/**
 * GoogleAnalytics — production-host gate (NEGATIVE case).
 *
 * Sibling file GoogleAnalytics.test.tsx covers the positive branch
 * (`isProductionHostForAnalytics -> true` → SPA page_view fires). This one
 * stubs the same fn to `false` and asserts that neither the render nor the
 * useEffect emits anything, mirroring what a live Amplify preview branch or
 * localhost session should look like.
 *
 * Split from the positive file because attempting to reconfigure the gate
 * mid-run is fragile — `Object.defineProperty(window, 'location', …)` throws
 * under this jsdom version. The pure gate fn itself is covered by
 * lib/analytics-host-gate.test.ts.
 */

jest.mock('@/lib/analytics', () => ({
  ...jest.requireActual('@/lib/analytics'),
  isProductionHostForAnalytics: () => false,
}));

let mockPathname = '/';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
jest.mock('next/script', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

import { render } from '@testing-library/react';
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics';

beforeEach(() => {
  mockPathname = '/';
  (window as unknown as { gtag: jest.Mock }).gtag = jest.fn();
});

it('renders nothing on a preview hostname even with a valid gaId', () => {
  const { container } = render(<GoogleAnalytics gaId="G-TEST" />);
  // `useState(false)` initial → effect flips based on hostname (non-prod → stays false)
  // → component returns null → container remains empty after effects flush.
  expect(container.innerHTML).toBe('');
});

it('does NOT fire page_view on route change from a preview host', () => {
  const { rerender } = render(<GoogleAnalytics gaId="G-TEST" />);
  (window.gtag as jest.Mock).mockClear();

  mockPathname = '/songs';
  rerender(<GoogleAnalytics gaId="G-TEST" />);

  const calls = (window.gtag as jest.Mock).mock.calls.filter((c) => c[1] === 'page_view');
  expect(calls).toHaveLength(0);
});
