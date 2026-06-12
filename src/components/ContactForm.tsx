'use client';

import { useState, useEffect } from 'react';

type Status = { type: 'idle' | 'sending' | 'success' | 'error'; message?: string };

export default function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', company: '' });
  const [status, setStatus] = useState<Status>({ type: 'idle' });

  // Pre-fill the subject from a ?subject= link (e.g. the "Order" CTAs).
  useEffect(() => {
    const subject = new URLSearchParams(window.location.search).get('subject');
    if (subject) setForm((prev) => ({ ...prev, subject }));
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus({ type: 'sending' });
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus({ type: 'success', message: data.message || 'Your message has been sent. Thank you!' });
        setForm({ name: '', email: '', subject: '', message: '', company: '' });
      } else {
        setStatus({ type: 'error', message: data.error || 'Something went wrong. Please try again.' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Network error. Please try again later.' });
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
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            autoComplete="name"
            value={form.name}
            onChange={handleChange}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="Your name"
          />
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
            autoComplete="email"
            inputMode="email"
            value={form.email}
            onChange={handleChange}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="you@example.com"
          />
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
          value={form.message}
          onChange={handleChange}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
          placeholder="Write your message..."
        />
      </div>

      {/* Status is announced to screen readers via the live region */}
      <div aria-live="polite">
        {status.type === 'success' && (
          <div role="status" className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3">
            {status.message}
          </div>
        )}
        {status.type === 'error' && (
          <div role="alert" className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3">
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
