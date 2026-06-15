'use client';

/**
 * Admin — Contact Messages
 *
 * Lists contact-form submissions stored in DynamoDB.
 */

import { useEffect, useState } from 'react';
import { Mail, RefreshCw } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

interface Message {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/contact');
      const data = await res.json();
      if (data.success) {
        setMessages(data.data);
      } else {
        setError(data.error || 'Failed to load messages');
      }
    } catch {
      setError('Failed to load messages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mail className="w-7 h-7 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900">
            Contact Messages
            {!loading && (
              <span className="ml-2 text-sm font-normal text-gray-500">({messages.length})</span>
            )}
          </h1>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading messages…</p>
      ) : error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 px-4 py-3">{error}</div>
      ) : messages.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Mail className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">No messages yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((m) => (
            <div key={m.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between gap-4 mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{m.subject}</h3>
                  <p className="text-sm text-gray-600">
                    {m.name} &lt;
                    <a href={`mailto:${m.email}`} className="text-purple-600 hover:underline">
                      {m.email}
                    </a>
                    &gt;
                  </p>
                </div>
                <time className="text-xs text-gray-400 whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="text-gray-700 whitespace-pre-wrap border-t border-gray-100 pt-3 mt-2">
                {m.message}
              </p>
              <div className="mt-3">
                <a
                  href={`mailto:${m.email}?subject=Re: ${encodeURIComponent(m.subject)}`}
                  className="inline-block px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700 transition-colors"
                >
                  Reply
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
