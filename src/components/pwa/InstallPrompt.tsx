'use client';

/**
 * InstallPrompt — a slim, dismissible top bar inviting visitors to install
 * Tamilagaval to their home screen. On Android/Chromium it triggers the native
 * install flow via the captured `beforeinstallprompt`; on iOS (no such API) it
 * shows the manual Share → Add to Home Screen hint. Dismissal is remembered, so
 * it asks at most once. All the when-to-show logic lives in lib/pwa-install.
 */

import { useEffect, useRef, useState } from 'react';
import { X, Share } from 'lucide-react';
import {
  detectPlatform,
  isStandalone,
  shouldOfferInstall,
  type InstallPlatform,
} from '@/lib/pwa-install';

const DISMISS_KEY = 'tamilagaval:pwa-install-dismissed:v1';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* storage blocked — the bar simply reappears next visit */
  }
}

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>('other');
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const dismissed = readDismissed();
    const standalone = isStandalone({
      displayModeStandalone: window.matchMedia?.('(display-mode: standalone)')?.matches,
      iosStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
    const plat = detectPlatform(window.navigator.userAgent);
    setPlatform(plat);

    // iOS has no beforeinstallprompt — decide immediately.
    if (shouldOfferInstall({ standalone, platform: plat, dismissed, hasNativePrompt: false })) {
      setVisible(true);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep Chrome's mini-infobar from also showing
      deferred.current = e as BeforeInstallPromptEvent;
      if (shouldOfferInstall({ standalone, platform: plat, dismissed, hasNativePrompt: true })) {
        setVisible(true);
      }
    };
    const onInstalled = () => {
      setVisible(false);
      rememberDismissed();
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    rememberDismissed();
  };

  const install = async () => {
    const ev = deferred.current;
    if (!ev) return;
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch {
      /* user backed out / unsupported */
    }
    deferred.current = null;
    dismiss();
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Install Tamilagaval"
      className="flex items-center gap-3 bg-gradient-to-r from-orange-500 to-orange-700 px-4 py-2 text-white"
    >
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/20 font-tamil text-lg font-bold"
      >
        த
      </span>

      {platform === 'ios' ? (
        <p className="flex-1 text-sm font-tamil leading-snug">
          தமிழகவலை நிறுவ:{' '}
          <span className="inline-flex items-center gap-1 font-semibold">
            <Share className="inline h-4 w-4" aria-hidden /> Share
          </span>{' '}
          → “Add to Home Screen”
        </p>
      ) : (
        <p className="flex-1 text-sm font-tamil leading-snug">
          தமிழகவலை உங்கள் முகப்புத் திரையில் நிறுவுங்கள் — ஒரு செயலி போல்.
        </p>
      )}

      {platform !== 'ios' && (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-full bg-white px-4 py-1.5 text-sm font-bold text-orange-700 transition hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          நிறுவு
        </button>
      )}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded-full p-1 text-white/80 transition hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
