'use client';

import { useState, useEffect } from 'react';

type Status = { type: 'idle' | 'sending' | 'success' | 'error'; message?: string };
type FieldErrors = { name?: string; email?: string; message?: string };

// Mirrors the server-side Zod caps in /api/contact so the user gets an instant
// ceiling instead of a 400 after typing past the limit.
const MAX = { name: 100, email: 200, subject: 150, message: 5000 } as const;

// Respectful Tamil copy (உங்கள் form), to match the rest of the page.
const T = {
  nameRequired: 'உங்கள் பெயரை உள்ளிடுங்கள்.',
  emailRequired: 'மின்னஞ்சல் முகவரியை உள்ளிடுங்கள்.',
  emailInvalid: 'சரியான மின்னஞ்சல் முகவரியை உள்ளிடுங்கள்.',
  messageRequired: 'செய்தியை உள்ளிடுங்கள்.',
  success: 'உங்கள் செய்தி அனுப்பப்பட்டது. நன்றி!',
  validationFailed: 'படிவத்தில் சில பிழைகள் உள்ளன. சரிசெய்து மீண்டும் அனுப்புங்கள்.',
  tooMany: 'அதிக முயற்சிகள். சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.',
  sendFailed: 'செய்தியை அனுப்ப முடியவில்லை. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.',
  networkError: 'இணைய இணைப்பில் சிக்கல். மீண்டும் முயற்சிக்கவும்.',
} as const;

// Same shape the server accepts; kept deliberately permissive (real validation
// is server-side) — this is only for immediate, accessible client feedback.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(form: { name: string; email: string; message: string }): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name.trim()) errors.name = T.nameRequired;
  if (!form.email.trim()) errors.email = T.emailRequired;
  else if (!EMAIL_RE.test(form.email.trim())) errors.email = T.emailInvalid;
  if (!form.message.trim()) errors.message = T.messageRequired;
  return errors;
}

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', company: '' });
  const [status, setStatus] = useState<Status>({ type: 'idle' });
  const [errors, setErrors] = useState<FieldErrors>({});

  // Pre-fill the subject from a ?subject= link (e.g. the "Order" CTAs).
  useEffect(() => {
    const subject = new URLSearchParams(window.location.search).get('subject');
    if (subject) setForm((prev) => ({ ...prev, subject }));
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Clear a field's error as soon as the user edits it.
    if (name in errors) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const found = validate(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setStatus({ type: 'error', message: T.validationFailed });
      // Move focus to the first invalid field for keyboard/SR users.
      const first = (['name', 'email', 'message'] as const).find((k) => found[k]);
      if (first) document.getElementById(first)?.focus();
      return;
    }

    setErrors({});
    setStatus({ type: 'sending' });
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        setStatus({ type: 'success', message: T.success });
        setForm({ name: '', email: '', subject: '', message: '', company: '' });
        return;
      }

      if (res.status === 429) {
        setStatus({ type: 'error', message: T.tooMany });
        return;
      }

      // Surface server-side field errors (e.g. email rejected at the API) on the
      // fields themselves so the message isn't a dead-end.
      const serverFields = data?.errors as Record<string, string[]> | undefined;
      if (res.status === 400 && serverFields) {
        setErrors({
          name: serverFields.name?.length ? T.nameRequired : undefined,
          email: serverFields.email?.length ? T.emailInvalid : undefined,
          message: serverFields.message?.length ? T.messageRequired : undefined,
        });
        setStatus({ type: 'error', message: T.validationFailed });
        return;
      }

      setStatus({ type: 'error', message: T.sendFailed });
    } catch {
      setStatus({ type: 'error', message: T.networkError });
    }
  };

  const sending = status.type === 'sending';

  const fieldProps = (name: keyof FieldErrors) => ({
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  });

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
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={MAX.name}
            autoComplete="name"
            value={form.name}
            onChange={handleChange}
            {...fieldProps('name')}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500"
            placeholder="Your name"
          />
          {errors.name && (
            <p id="name-error" className="mt-1 text-sm text-red-600 font-tamil">
              {errors.name}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email <span className="text-red-500">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            maxLength={MAX.email}
            autoComplete="email"
            inputMode="email"
            value={form.email}
            onChange={handleChange}
            {...fieldProps('email')}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500"
            placeholder="you@example.com"
          />
          {errors.email && (
            <p id="email-error" className="mt-1 text-sm text-red-600 font-tamil">
              {errors.email}
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          type="text"
          maxLength={MAX.subject}
          value={form.subject}
          onChange={handleChange}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="What is this about?"
        />
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
          Message <span className="text-red-500">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          maxLength={MAX.message}
          value={form.message}
          onChange={handleChange}
          {...fieldProps('message')}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500"
          placeholder="Write your message..."
        />
        {errors.message && (
          <p id="message-error" className="mt-1 text-sm text-red-600 font-tamil">
            {errors.message}
          </p>
        )}
      </div>

      {/* Single polite live region — announces success/error once (no nested
          role=status/alert, which some screen readers double-announce). */}
      <div aria-live="polite">
        {status.type === 'success' && (
          <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3 font-tamil">
            {status.message}
          </div>
        )}
        {status.type === 'error' && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3 font-tamil">
            {status.message}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={sending}
        className="px-8 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  );
}
