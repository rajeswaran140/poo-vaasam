'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';

interface Row {
  token: string; filename: string; label: string;
  downloadCount: number; maxDownloads: number; expiresAt: string; revokedAt: string | null;
}

export function DeliveryManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [form, setForm] = useState({ s3Key: '', filename: '', label: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await adminFetch('/api/admin/deliveries');
    const body = await res.json();
    setRows(body.deliveries ?? []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = useCallback(async () => {
    setBusy(true); setError(null); setCreated(null);
    try {
      const res = await adminFetch('/api/admin/deliveries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not create the link.');
      setCreated(body.url);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setBusy(false); }
  }, [form, load]);

  const revoke = useCallback(async (token: string) => {
    await adminFetch(`/api/admin/deliveries/${token}/revoke`, { method: 'POST' });
    await load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border border-gray-200 p-4">
        {(['s3Key', 'filename', 'label'] as const).map((f) => (
          <div key={f}>
            <label htmlFor={`d-${f}`} className="block text-xs font-medium text-gray-600">
              {f === 's3Key' ? 'S3 key (must be under deliveries/)' : f === 'filename' ? 'Filename the buyer sees' : 'Label for your reference'}
            </label>
            <input
              id={`d-${f}`}
              value={form[f]}
              onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create link
        </button>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {created && (
          <input readOnly value={created} onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm" />
        )}
      </div>

      {rows === null ? <p className="text-sm text-gray-500">Loading…</p>
        : rows.length === 0 ? <p className="text-sm text-gray-500">No delivery links yet.</p>
        : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.token} className="flex flex-wrap items-center gap-3 rounded border border-gray-200 px-3 py-2 text-sm">
              <span className="grow truncate">{r.label}</span>
              <span className="text-xs text-gray-500">{r.filename}</span>
              <span className="tabular-nums text-xs">{r.downloadCount} / {r.maxDownloads}</span>
              <span className="text-xs text-gray-500">{r.expiresAt.slice(0, 10)}</span>
              {r.revokedAt
                ? <span className="text-xs text-gray-400">revoked</span>
                : <button type="button" onClick={() => void revoke(r.token)}
                    className="text-xs font-medium text-red-600 hover:underline">Revoke</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
