/**
 * pwa-install — pure decision logic for the "Add to Home Screen" prompt.
 *
 * The component (components/pwa/InstallPrompt) owns the DOM/event wiring; the
 * rules for WHEN to offer install live here so they're exhaustively testable
 * without a browser.
 */

export type InstallPlatform = 'ios' | 'android' | 'other';

/** Coarse platform classification from a user-agent string. */
export function detectPlatform(ua: string | undefined): InstallPlatform {
  const s = (ua ?? '').toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return 'ios';
  if (/android/.test(s)) return 'android';
  return 'other';
}

export interface StandaloneSignals {
  /** matchMedia('(display-mode: standalone)').matches */
  displayModeStandalone?: boolean;
  /** iOS Safari: navigator.standalone === true */
  iosStandalone?: boolean;
}

/** Already running as an installed app? Then there's nothing to offer. */
export function isStandalone(signals: StandaloneSignals): boolean {
  return Boolean(signals.displayModeStandalone || signals.iosStandalone);
}

export interface OfferInstallInput {
  standalone: boolean;
  platform: InstallPlatform;
  dismissed: boolean;
  /** A `beforeinstallprompt` event has been captured (Android/Chromium). */
  hasNativePrompt: boolean;
}

/**
 * Offer the install bar only when the app isn't already installed, the user
 * hasn't dismissed it, and we can actually guide an install — either a captured
 * native prompt (Android/Chromium) or iOS (manual Add-to-Home-Screen steps).
 * Desktop/other browsers without a native prompt get nothing.
 */
export function shouldOfferInstall(input: OfferInstallInput): boolean {
  if (input.standalone || input.dismissed) return false;
  if (input.hasNativePrompt) return true;
  return input.platform === 'ios';
}
