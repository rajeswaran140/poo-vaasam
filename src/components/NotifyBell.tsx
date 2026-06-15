'use client';

/**
 * Opt-in "get new-song alerts" button (web push). Renders nothing on browsers
 * that don't support push, or when VAPID isn't configured — so it never shows a
 * dead control. On click it registers the service worker, asks permission,
 * subscribes, and POSTs the subscription to /api/push/subscribe.
 */

import { useEffect, useState } from 'react';
import { Bell, BellRing, Check } from 'lucide-react';
import { isPushSupported, subscribeToPush } from '@/lib/push-client';

type State = 'idle' | 'working' | 'subscribed' | 'denied' | 'error';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export function NotifyBell({ className = '' }: { className?: string }) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setSupported(isPushSupported() && !!VAPID);
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') setState('denied');
  }, []);

  if (!supported) return null;

  async function enable() {
    setState('working');
    setMsg('');
    try {
      const sub = await subscribeToPush(VAPID);
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error(`Couldn’t save subscription (${res.status})`);
      setState('subscribed');
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Something went wrong';
      setState(/permission/i.test(text) ? 'denied' : 'error');
      setMsg(text);
    }
  }

  if (state === 'subscribed') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-green-100 px-4 py-2 font-tamil text-sm font-medium text-green-800 ${className}`}>
        <Check className="h-4 w-4" aria-hidden /> புதிய பாடல் அறிவிப்புகள் இயக்கப்பட்டது
      </span>
    );
  }

  if (state === 'denied') {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-4 py-2 font-tamil text-sm text-gray-600 ${className}`}>
        <Bell className="h-4 w-4" aria-hidden /> அறிவிப்புகள் தடைசெய்யப்பட்டுள்ளன — உலாவி அமைப்பில் அனுமதிக்கவும்
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={enable}
      disabled={state === 'working'}
      aria-label="புதிய பாடல் அறிவிப்புகளைப் பெறு"
      className={`inline-flex items-center gap-2 rounded-full bg-orange-600 px-5 py-2.5 font-tamil text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-60 ${className}`}
      title={msg || undefined}
    >
      <BellRing className="h-4 w-4" aria-hidden />
      {state === 'working' ? 'இயக்குகிறது…' : 'புதிய பாடல் அறிவிப்புகள்'}
    </button>
  );
}
