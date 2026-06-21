'use client';

/**
 * Admin — Email Subscribers
 *
 * Manage the email newsletter list (the owned audience from the site subscribe
 * form). Filter by join-date range + status, see daily signups/unsubscribes,
 * and process unsubscribes (admin-driven). NOT YouTube subscribers — those
 * aren't exposed by any API.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, RefreshCw, Download, UserMinus, UserCheck } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

interface Subscriber {
  email: string;
  source: string;
  status: 'SUBSCRIBED' | 'UNSUBSCRIBED';
  createdAt: string;
  unsubscribedAt?: string;
}
interface DailyCount {
  date: string;
  signups: number;
  unsubscribes: number;
}
interface Payload {
  data: Subscriber[];
  total: number;
  summary: { subscribed: number; unsubscribed: number; total: number };
  daily: DailyCount[];
}

type StatusFilter = 'all' | 'subscribed' | 'unsubscribed';

export default function SubscribersPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // email being mutated

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      qs.set('status', status);
      const res = await adminFetch(`/api/admin/subscribers?${qs.toString()}`);
      const json = await res.json();
      if (json.success) setPayload(json);
      else setError(json.error || 'Failed to load subscribers');
    } catch {
      setError('Failed to load subscribers');
    } finally {
      setLoading(false);
    }
  }, [from, to, status]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = async (email: string, action: 'unsubscribe' | 'resubscribe') => {
    setBusy(email);
    try {
      const res = await adminFetch('/api/admin/subscribers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action }),
      });
      const json = await res.json();
      if (json.success) await load();
      else setError(json.error || 'Update failed');
    } catch {
      setError('Update failed');
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    const rows = payload?.data ?? [];
    const head = 'email,source,status,createdAt,unsubscribedAt';
    const body = rows
      .map((s) =>
        [s.email, s.source, s.status, s.createdAt, s.unsubscribedAt ?? '']
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([`${head}\n${body}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subscribers-${status}${from ? `-${from}` : ''}${to ? `-${to}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rangeSignups = (payload?.daily ?? []).reduce((n, d) => n + d.signups, 0);
  const rangeUnsubs = (payload?.daily ?? []).reduce((n, d) => n + d.unsubscribes, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-7 h-7 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900">
            Email Subscribers
            {payload && <span className="ml-2 text-sm font-normal text-gray-500">({payload.total} shown)</span>}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={!payload?.data.length} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            <Download className="w-4 h-4" /> CSV
          </button>
          <button onClick={load} className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {payload && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Active subscribers" value={payload.summary.subscribed} tone="green" />
          <Stat label="Unsubscribed (all-time)" value={payload.summary.unsubscribed} tone="red" />
          <Stat label="Signups in range" value={rangeSignups} tone="purple" />
          <Stat label="Unsubscribes in range" value={rangeUnsubs} tone="amber" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <Field label="From (join date)">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </Field>
        <Field label="To (join date)">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="all">All</option>
            <option value="subscribed">Subscribed</option>
            <option value="unsubscribed">Unsubscribed</option>
          </select>
        </Field>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); }} className="rounded-lg px-3 py-2 text-sm text-gray-500 hover:text-gray-800">
            Clear dates
          </button>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* Table */}
      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : !payload?.data.length ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
          <Users className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="text-gray-500">No subscribers for this filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Joined</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payload.data.map((s) => (
                <tr key={s.email} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><a href={`mailto:${s.email}`} className="text-purple-600 hover:underline">{s.email}</a></td>
                  <td className="px-4 py-3 text-gray-600">{s.source}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.status === 'SUBSCRIBED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {s.status === 'SUBSCRIBED' ? 'Subscribed' : 'Unsubscribed'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {s.status === 'SUBSCRIBED' ? (
                      <button onClick={() => mutate(s.email, 'unsubscribe')} disabled={busy === s.email} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40">
                        <UserMinus className="h-3.5 w-3.5" /> Unsubscribe
                      </button>
                    ) : (
                      <button onClick={() => mutate(s.email, 'resubscribe')} disabled={busy === s.email} className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-40">
                        <UserCheck className="h-3.5 w-3.5" /> Re-subscribe
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'purple' | 'amber' }) {
  const tones = {
    green: 'text-green-700', red: 'text-red-700', purple: 'text-purple-700', amber: 'text-amber-700',
  };
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}
