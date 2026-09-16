'use client';

/**
 * Karaoke request form for /karaoke.
 *
 * DELIBERATELY NOT `CommissionForm`. That one asks for occasion, mood, length,
 * language and a reference link — a brief for a song that does not exist yet.
 * A karaoke buyer is naming a song that DOES exist, so four fields is the whole
 * brief. Reusing the larger form would have meant showing five inputs nobody
 * can answer, which reads as a form nobody thought about.
 *
 * Posts to /api/contact with its own subject, so karaoke leads are separable
 * from composition leads in /admin/messages.
 */

import { useMemo, useState } from 'react';
import {
  KARAOKE_SUBJECT,
  KARAOKE_PRICE_LABEL,
  KARAOKE_TURNAROUND_LABEL,
  buildKaraokeSummary,
  type KaraokeFields,
} from '@/lib/karaoke';
import { hasWhatsApp, whatsappLink } from '@/config/music';

const EMPTY: KaraokeFields = { name: '', email: '', song: '', notes: '' };

interface Props {
  /** Songs from the live catalogue. Empty is fine — the field falls back to free text. */
  songs?: string[];
}

export function KaraokeRequestForm({ songs = [] }: Props) {
  const [f, setF] = useState<KaraokeFields>(EMPTY);
  const [company, setCompany] = useState(''); // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const set = (k: keyof KaraokeFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const ready = Boolean(f.name.trim() && f.email.trim() && f.song.trim());
  const waHref = useMemo(() => (hasWhatsApp() ? whatsappLink(buildKaraokeSummary(f)) : ''), [f]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) {
      setError('பெயர், மின்னஞ்சல், பாடல் தேவை · Name, email and song are required.');
      return;
    }
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: f.name, email: f.email,
          subject: KARAOKE_SUBJECT,
          message: buildKaraokeSummary(f),
          company,
        }),
      });
      if (!res.ok) throw new Error('failed');
      setStatus('sent');
    } catch {
      setStatus('error');
      setError('அனுப்ப முடியவில்லை — WhatsApp மூலம் முயற்சிக்கவும் · Couldn’t send — please try WhatsApp.');
    }
  };

  if (status === 'sent') {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-green-500/40 bg-green-500/10 p-8 text-center">
        <div className="mb-3 text-5xl" aria-hidden>✅</div>
        <h3 className="mb-2 font-tamil text-2xl font-bold text-white">கோரிக்கை பெறப்பட்டது!</h3>
        <p className="font-tamil text-gray-200">
          நன்றி — விரைவில் உங்களைத் தொடர்புகொள்கிறோம்.{' '}
          <span className="text-gray-400">We’ll confirm the song and send a payment link.</span>
        </p>
      </div>
    );
  }

  const input = 'w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 font-tamil text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500';

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-gray-700 bg-gray-800/60 p-6 sm:p-8" aria-label="Karaoke request">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">பெயர் · Name *</span>
          <input value={f.name} onChange={set('name')} required className={input} placeholder="உங்கள் பெயர்" />
        </label>
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">மின்னஞ்சல் · Email *</span>
          <input type="email" value={f.email} onChange={set('email')} required className={input} placeholder="you@example.com" />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block font-tamil text-sm text-gray-300">எந்தப் பாடல்? · Which song? *</span>
        {songs.length > 0 ? (
          <select value={f.song} onChange={set('song')} required className={input}>
            <option value="">— தேர்வு செய்க · Choose a song —</option>
            {songs.map((s) => <option key={s} value={s} className="bg-gray-900">{s}</option>)}
          </select>
        ) : (
          // No catalogue to offer — never show an empty dropdown, which looks broken.
          <input value={f.song} onChange={set('song')} required className={input} placeholder="பாடலின் பெயர் · Song title" />
        )}
      </label>

      <label className="block">
        <span className="mb-1 block font-tamil text-sm text-gray-300">குறிப்புகள் · Notes (optional)</span>
        <textarea value={f.notes ?? ''} onChange={set('notes')} rows={4} className={input} placeholder="எ.கா. குறைந்த ஸ்ருதி, சிறிய பதிப்பு… · e.g. lower key, shorter edit…" />
      </label>

      {/* Honeypot — hidden from real users. */}
      <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

      {error && <p role="alert" className="font-tamil text-sm text-red-400">{error}</p>}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" disabled={status === 'sending'} className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-orange-600 px-6 py-3.5 font-tamil text-lg font-bold text-white shadow-lg transition-colors hover:bg-orange-700 disabled:opacity-60">
          {status === 'sending' ? 'அனுப்புகிறது…' : 'கோரிக்கையை அனுப்பு · Send request'}
        </button>
        {hasWhatsApp() && (
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full bg-green-500 px-6 py-3.5 font-tamil text-lg font-bold text-white shadow-lg transition-colors hover:bg-green-600">
            <span aria-hidden>💬</span> WhatsApp
          </a>
        )}
      </div>
      <p className="text-center font-tamil text-xs text-gray-500">
        {KARAOKE_PRICE_LABEL} per song · {KARAOKE_TURNAROUND_LABEL}.{' '}
        <span className="text-gray-600">Payment link sent after we confirm the song.</span>
      </p>
    </form>
  );
}
