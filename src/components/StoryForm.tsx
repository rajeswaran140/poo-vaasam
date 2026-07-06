'use client';

/**
 * StoryForm — the visitor "Share Your Story" form.
 *
 * Mirrors ContactForm: honeypot, inline confirmation, posts JSON to
 * /api/stories. Visitor-facing Tamil copy uses the RESPECTFUL -உங்கள் register
 * (பகிருங்கள், not பகிர்).
 */

import { useState } from 'react';
import { STORY_THEMES, STORY_THEME_LABELS } from '@/types/story';

type Status = { type: 'idle' | 'sending' | 'success' | 'error'; message?: string };

const initialForm = {
  name: '',
  theme: 'mother',
  story: '',
  email: '',
  featureConsent: false,
  company: '',
};

export default function StoryForm() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: 'sending' });
    try {
      const res = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus({
          type: 'success',
          message: data.message || 'உங்கள் கதைக்கு நன்றி!',
        });
        setForm(initialForm);
      } else {
        setStatus({
          type: 'error',
          message: data.error || 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சி செய்யுங்கள்.',
        });
      }
    } catch {
      setStatus({ type: 'error', message: 'இணைப்பு பிழை. பிறகு முயற்சி செய்யுங்கள்.' });
    }
  };

  const sending = status.type === 'sending';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Honeypot field — hidden from users, hidden from assistive tech */}
      <input
        type="text"
        name="company"
        value={form.company}
        onChange={handleChange}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <label htmlFor="story-name" className="block text-sm font-medium text-gray-700 mb-1">
            உங்கள் பெயர் <span className="text-red-500">*</span>
          </label>
          <input
            id="story-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={form.name}
            onChange={handleChange}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-tamil"
            placeholder="உங்கள் பெயர்"
          />
        </div>
        <div>
          <label htmlFor="story-theme" className="block text-sm font-medium text-gray-700 mb-1">
            கதையின் கருப்பொருள் <span className="text-red-500">*</span>
          </label>
          <select
            id="story-theme"
            name="theme"
            required
            value={form.theme}
            onChange={handleChange}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 font-tamil bg-white"
          >
            {STORY_THEMES.map((t) => (
              <option key={t} value={t}>
                {STORY_THEME_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="story-body" className="block text-sm font-medium text-gray-700 mb-1">
          உங்கள் நினைவு / கதை <span className="text-red-500">*</span>
        </label>
        <textarea
          id="story-body"
          name="story"
          required
          rows={6}
          value={form.story}
          onChange={handleChange}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y font-tamil"
          placeholder="உங்கள் நினைவை எங்களுடன் பகிருங்கள்…"
        />
      </div>

      <div>
        <label htmlFor="story-email" className="block text-sm font-medium text-gray-700 mb-1">
          மின்னஞ்சல் <span className="text-gray-400 font-normal">(விருப்பம்)</span>
        </label>
        <input
          id="story-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={form.email}
          onChange={handleChange}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="you@example.com"
        />
        <p className="mt-1 text-xs text-gray-500 font-tamil">
          மின்னஞ்சல் தந்தால் புதிய பாடல்கள் உங்களுக்கு வரும்.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <input
          id="story-consent"
          name="featureConsent"
          type="checkbox"
          checked={form.featureConsent}
          onChange={handleChange}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
        />
        <label htmlFor="story-consent" className="text-sm text-gray-700 font-tamil">
          என் கதையை தமிழகவல் பகிரலாம் / You may feature my story
        </label>
      </div>

      {/* Status is announced to screen readers via the live region */}
      <div aria-live="polite">
        {status.type === 'success' && (
          <div role="status" className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3 font-tamil">
            {status.message}
          </div>
        )}
        {status.type === 'error' && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3 font-tamil">
            {status.message}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={sending}
        className="px-8 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-tamil"
      >
        {sending ? 'அனுப்புகிறது…' : 'கதையைப் பகிருங்கள்'}
      </button>
    </form>
  );
}
