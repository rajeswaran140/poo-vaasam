'use client';

/**
 * Email subscription form — captures the audience you OWN (algorithm-independent).
 * Posts to the public /api/subscribe endpoint. Includes a hidden honeypot field
 * for bot resistance; shows an inline confirmation on success.
 */

import { useState } from 'react';

export function SubscribeForm({ source = 'footer' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState(''); // honeypot — must stay empty
  const [state, setState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || state === 'submitting') return;
    setState('submitting');
    setMsg('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source, company }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setState('done');
      setMsg(body.message || 'நன்றி!');
    } catch (err) {
      setState('error');
      setMsg(err instanceof Error ? err.message : 'Subscription failed.');
    }
  };

  if (state === 'done') {
    return (
      <p role="status" className="font-tamil text-sm text-orange-300">
        {msg}
      </p>
    );
  }

  return (
    <form onSubmit={submit} aria-label="மின்னஞ்சல் சந்தா" className="w-full max-w-sm">
      <label htmlFor="subscribe-email" className="mb-2 block font-tamil text-sm text-gray-300">
        புதிய பாடல்கள் மற்றும் கதைகளை மின்னஞ்சலில் பெறுங்கள்
      </label>
      <div className="flex gap-2">
        <input
          id="subscribe-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="உங்கள் மின்னஞ்சல்"
          className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-tamil text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
        <button
          type="submit"
          disabled={state === 'submitting'}
          className="shrink-0 rounded-lg bg-orange-600 px-4 py-2 font-tamil text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
        >
          {state === 'submitting' ? '…' : 'சேர்'}
        </button>
      </div>
      {/* Honeypot — visually hidden; bots fill it, humans don't. */}
      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="hidden"
      />
      {state === 'error' && (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {msg}
        </p>
      )}
    </form>
  );
}
