'use client';

/**
 * Structured commission request form for /music-composition. Captures a real
 * brief (occasion, mood, length, reference, lyrics) → posts to /api/contact
 * (stored as a CONTACT# lead, surfaced in /admin/messages + the daily digest)
 * AND offers a WhatsApp hand-off pre-filled with the same brief. Turns the
 * leaky "blank contact form" funnel into a qualified-lead funnel.
 */

import { useMemo, useState } from 'react';
import { OCCASIONS, MOODS, COMMISSION_SUBJECT, buildCommissionSummary, type CommissionFields } from '@/lib/commission';
import { hasWhatsApp, whatsappLink } from '@/config/music';

const EMPTY: CommissionFields = { name: '', email: '', occasion: '', language: '', mood: '', length: '', reference: '', details: '' };

export function CommissionForm() {
  const [f, setF] = useState<CommissionFields>(EMPTY);
  const [company, setCompany] = useState(''); // honeypot
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  const set = (k: keyof CommissionFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const ready = f.name.trim() && f.email.trim() && f.details.trim();
  const waHref = useMemo(() => (hasWhatsApp() ? whatsappLink(buildCommissionSummary(f)) : ''), [f]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) { setError('பெயர், மின்னஞ்சல், பாடல் வரிகள் தேவை · Name, email and lyrics are required.'); return; }
    setStatus('sending'); setError('');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, email: f.email, subject: COMMISSION_SUBJECT, message: buildCommissionSummary(f), company }),
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
        <p className="font-tamil text-gray-200">நன்றி — விரைவில் உங்களைத் தொடர்புகொள்கிறோம். <span className="text-gray-400">We’ll get back to you shortly.</span></p>
      </div>
    );
  }

  const input = 'w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 font-tamil text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500';

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-gray-700 bg-gray-800/60 p-6 sm:p-8" aria-label="Music composition commission request">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">பெயர் · Name *</span>
          <input value={f.name} onChange={set('name')} required className={input} placeholder="உங்கள் பெயர்" />
        </label>
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">மின்னஞ்சல் · Email *</span>
          <input type="email" value={f.email} onChange={set('email')} required className={input} placeholder="you@example.com" />
        </label>
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">சந்தர்ப்பம் · Occasion</span>
          <select value={f.occasion} onChange={set('occasion')} className={input}>
            <option value="">— தேர்வு செய்க —</option>
            {OCCASIONS.map((o) => <option key={o} value={o} className="bg-gray-900">{o}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">இசை வகை · Mood / Style</span>
          <select value={f.mood} onChange={set('mood')} className={input}>
            <option value="">— தேர்வு செய்க —</option>
            {MOODS.map((m) => <option key={m} value={m} className="bg-gray-900">{m}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">மொழி · Language</span>
          <input value={f.language} onChange={set('language')} className={input} placeholder="தமிழ் / Tamil" />
        </label>
        <label className="block">
          <span className="mb-1 block font-tamil text-sm text-gray-300">தோராயமான நீளம் · Length</span>
          <input value={f.length} onChange={set('length')} className={input} placeholder="≈ 4 நிமிடம்" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block font-tamil text-sm text-gray-300">குறிப்பு பாடல் இணைப்பு · Reference link (optional)</span>
        <input value={f.reference} onChange={set('reference')} className={input} placeholder="https://youtu.be/…" />
      </label>
      <label className="block">
        <span className="mb-1 block font-tamil text-sm text-gray-300">பாடல் வரிகள் / விவரங்கள் · Lyrics / details *</span>
        <textarea value={f.details} onChange={set('details')} required rows={6} className={input} placeholder="உங்கள் பாடல் வரிகளையும், எண்ணங்களையும் இங்கே எழுதுங்கள்…" />
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
        இலவச மதிப்பீடு · Free quote — no obligation.{' '}
        <span className="text-gray-600">Starting from CAD $75 · 5–7 working days.</span>
      </p>
    </form>
  );
}
