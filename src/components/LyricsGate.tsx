'use client';

/**
 * Lyrics email-gate (client).
 *
 * The gate cookie is httpOnly, so the browser can't read it — instead we ASK the
 * server on mount whether this browser is unlocked (GET /api/lyrics/<songId>):
 *   - 200 → render the lyrics.
 *   - 401 → show the unlock form (name + email + honeypot). On submit we POST
 *     /api/lyrics/unlock (captures the email as a lead + sets the gate cookie),
 *     then re-fetch the lyrics.
 * The lyrics are free — this is a quick sign-up, not a paywall.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface Lyrics {
  id: string;
  title: string;
  body: string;
}

type Status = 'loading' | 'locked' | 'unlocked' | 'error';

export function LyricsGate({ songId, songTitle }: { songId: string; songTitle: string }) {
  const [status, setStatus] = useState<Status>('loading');
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);

  // Unlock-form state.
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState(''); // honeypot — must stay empty
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const loadLyrics = useCallback(async () => {
    try {
      const res = await fetch(`/api/lyrics/${songId}`, { credentials: 'include' });
      if (res.status === 401) {
        setStatus('locked');
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success && json.lyrics) {
        setLyrics(json.lyrics);
        setStatus('unlocked');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }, [songId]);

  useEffect(() => {
    loadLyrics();
  }, [loadLyrics]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setFormError('');
    try {
      const res = await fetch('/api/lyrics/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, name, songId, company }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || `HTTP ${res.status}`);
      // Cookie is now set — ask the server for the lyrics.
      setStatus('loading');
      await loadLyrics();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சி செய்யுங்கள்.');
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading') {
    return (
      <p role="status" className="font-tamil text-gray-400">
        ஏற்றுகிறது…
      </p>
    );
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-center">
        <p className="font-tamil text-red-300">
          பாடல் வரிகளை ஏற்ற முடியவில்லை. பின்னர் மீண்டும் முயற்சி செய்யுங்கள்.
        </p>
      </div>
    );
  }

  if (status === 'unlocked' && lyrics) {
    return (
      <div>
        <pre
          className="mb-0 whitespace-pre-wrap font-poem text-lg leading-loose text-gray-100 sm:text-xl"
          style={{ lineHeight: '2.2', letterSpacing: '0.5px' }}
        >
          {lyrics.body}
        </pre>
        <p className="mt-8 border-t border-gray-800 pt-4 font-tamil text-xs text-gray-500">
          © Rajeswaran Thangarajah · பாடுவதற்கு மட்டுமே / for singing only ·{' '}
          <Link href="/terms" className="text-orange-400 hover:underline">
            விதிமுறைகள்
          </Link>
        </p>
      </div>
    );
  }

  // status === 'locked' → the unlock form.
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-gray-800 bg-gray-900/70 p-6 sm:p-8">
      <div className="mb-4 text-center">
        <span className="text-3xl">📜</span>
        <h2 className="mt-2 font-tamil text-xl font-bold text-white">
          பாடல் வரிகளைப் பார்க்க பதிவு செய்யுங்கள்
        </h2>
        <p className="mt-2 font-tamil text-sm text-gray-400">
          பாடல் வரிகள் இலவசம். உங்கள் பெயரையும் மின்னஞ்சலையும் பகிர்ந்தால் உடனே
          திறக்கும் — புதிய பாடல்களும் உங்களை வந்தடையும்.
        </p>
      </div>

      <form onSubmit={submit} aria-label="பாடல் வரிகள் பதிவு">
        <label htmlFor="lyrics-name" className="mb-1 block font-tamil text-sm text-gray-300">
          உங்கள் பெயர்
        </label>
        <input
          id="lyrics-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="உங்கள் பெயர்"
          autoComplete="name"
          className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-tamil text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />

        <label htmlFor="lyrics-email" className="mb-1 block font-tamil text-sm text-gray-300">
          உங்கள் மின்னஞ்சல்
        </label>
        <input
          id="lyrics-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="உங்கள் மின்னஞ்சல்"
          autoComplete="email"
          className="mb-4 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 font-tamil text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />

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

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-orange-600 px-4 py-2.5 font-tamil text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60"
        >
          {submitting ? '…' : 'பாடல் வரிகளைப் பார்க்க'}
        </button>

        {formError && (
          <p role="alert" className="mt-3 text-xs text-red-400">
            {formError}
          </p>
        )}
      </form>

      <p className="mt-4 text-center font-tamil text-xs text-gray-500">
        “{songTitle}” — பாடல் வரிகள்
      </p>
    </div>
  );
}
