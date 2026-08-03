'use client';

/**
 * Registers the service worker for the Mastering studio and offers to install
 * it as a standalone app.
 *
 * Separate from the public site's <InstallPrompt> on purpose: that one is a
 * top-of-page bar for first-time visitors, this is a quiet button for one
 * operator, and the two must remember their dismissals independently or
 * declining the site app would silently suppress this one too.
 *
 * ⚠️ REGISTRATION IS THE POINT. The manifest alone does not make an app
 * installable in browsers that still require a service worker with a fetch
 * handler, and /sw.js is otherwise registered only when someone opts into push
 * notifications — which an admin never does. Without this the Install option
 * simply never appears, with nothing to indicate why.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, Check } from 'lucide-react';
import { detectPlatform, isStandalone, shouldOfferInstall } from '@/lib/pwa-install';

const DISMISS_KEY = 'tamilagaval:mastering-install-dismissed:v1';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function MasteringInstall() {
  const [offer, setOffer] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    void navigator.serviceWorker?.register('/sw.js').catch(() => {
      /* Registration can fail on an unsupported or locked-down browser; the
         studio itself is unaffected, so this stays silent. */
    });

    const standalone = isStandalone({
      displayModeStandalone: window.matchMedia?.('(display-mode: standalone)')?.matches,
      iosStandalone: (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
    });
    if (standalone) {
      setInstalled(true);
      return;
    }

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* storage blocked — the button simply reappears next visit */
    }

    const platform = detectPlatform(window.navigator.userAgent);
    // iOS has no beforeinstallprompt, so the decision can be made at once.
    if (shouldOfferInstall({ standalone, platform, dismissed, hasNativePrompt: false })) {
      setOffer(true);
      setIosHint(platform === 'ios');
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as BeforeInstallPromptEvent;
      if (!dismissed) {
        setOffer(true);
        setIosHint(false);
      }
    };
    const onInstalled = () => {
      setOffer(false);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    const evt = deferred.current;
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    deferred.current = null;
    if (outcome === 'accepted') setInstalled(true);
    setOffer(false);
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignored — see above */
    }
    setOffer(false);
  };

  if (installed) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
        Running as an installed app.
      </p>
    );
  }
  if (!offer) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50">
      {iosHint ? (
        <p className="text-xs text-gray-700 dark:text-gray-300">
          Install this studio: tap <strong>Share</strong>, then{' '}
          <strong>Add to Home Screen</strong>.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-700 dark:text-gray-300">
            Install the mastering studio as its own app — it opens without browser chrome.
          </p>
          <button
            type="button"
            onClick={install}
            className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-700"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Install
          </button>
        </>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="ml-auto text-xs text-gray-500 underline hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
      >
        Not now
      </button>
    </div>
  );
}
