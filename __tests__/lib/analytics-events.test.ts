/** @jest-environment jsdom */
/**
 * Unit tests for src/lib/analytics-events.ts — verify that the helpers
 * call window.gtag with the right shape and no-op when gtag is missing.
 */

import { trackSubscribeClick } from '@/lib/analytics-events';

describe('trackSubscribeClick', () => {
  const original = (window as unknown as { gtag?: unknown }).gtag;
  afterEach(() => {
    (window as unknown as { gtag?: unknown }).gtag = original;
  });

  it('fires a subscribe_click event with source param via window.gtag', () => {
    const spy = jest.fn();
    (window as unknown as { gtag: unknown }).gtag = spy;

    trackSubscribeClick('home_hero');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('event', 'subscribe_click', { source: 'home_hero' });
  });

  it('no-ops silently when gtag is missing (script not yet loaded)', () => {
    delete (window as unknown as { gtag?: unknown }).gtag;
    expect(() => trackSubscribeClick('floater')).not.toThrow();
  });

  it('no-ops silently when gtag is not a function', () => {
    (window as unknown as { gtag?: unknown }).gtag = 'not a function';
    expect(() => trackSubscribeClick('footer')).not.toThrow();
  });
});
