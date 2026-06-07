/** @jest-environment node */
/**
 * pwa-install — the pure decision logic behind the "Add to Home Screen" bar.
 * Keeping the when-to-offer rules here (not in the component) makes every
 * branch testable without a DOM.
 */

import { detectPlatform, isStandalone, shouldOfferInstall } from '@/lib/pwa-install';

describe('detectPlatform', () => {
  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', 'ios'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) Safari', 'ios'],
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome', 'android'],
    ['Desktop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome', 'other'],
    ['empty', '', 'other'],
  ])('classifies %s', (_label, ua, expected) => {
    expect(detectPlatform(ua)).toBe(expected);
  });

  it('handles a missing user-agent', () => {
    expect(detectPlatform(undefined)).toBe('other');
  });
});

describe('isStandalone', () => {
  it('is true when launched via display-mode standalone (Android/Chromium)', () => {
    expect(isStandalone({ displayModeStandalone: true })).toBe(true);
  });
  it('is true when launched via navigator.standalone (iOS)', () => {
    expect(isStandalone({ iosStandalone: true })).toBe(true);
  });
  it('is false in a normal browser tab', () => {
    expect(isStandalone({ displayModeStandalone: false, iosStandalone: false })).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
});

describe('shouldOfferInstall', () => {
  const base = { standalone: false, platform: 'android' as const, dismissed: false, hasNativePrompt: true };

  it('offers when a native prompt was captured (Android/Chromium)', () => {
    expect(shouldOfferInstall(base)).toBe(true);
  });
  it('offers on iOS even without a native prompt (manual instructions)', () => {
    expect(shouldOfferInstall({ ...base, platform: 'ios', hasNativePrompt: false })).toBe(true);
  });
  it('never offers once already installed', () => {
    expect(shouldOfferInstall({ ...base, standalone: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, standalone: true, platform: 'ios', hasNativePrompt: false })).toBe(false);
  });
  it('never offers after the user dismissed it', () => {
    expect(shouldOfferInstall({ ...base, dismissed: true })).toBe(false);
  });
  it('stays silent on desktop/other without a native prompt', () => {
    expect(shouldOfferInstall({ ...base, platform: 'other', hasNativePrompt: false })).toBe(false);
  });
  it('stays silent on Android until the native prompt actually fires', () => {
    expect(shouldOfferInstall({ ...base, hasNativePrompt: false })).toBe(false);
  });
});
