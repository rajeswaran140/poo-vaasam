'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';

interface Row {
  token: string; filename: string; label: string;
  downloadCount: number; maxDownloads: number; expiresAt: string; revokedAt: string | null;
  /** Built by the API, so the browser never assembles a link itself. */
  url: string;
}

/**
 * The shape of each field, shown in the field. The S3 key is the one that gets
 * typed wrong — a label saying "must be under deliveries/" does not show what
 * a whole key looks like.
 */
const PLACEHOLDERS: Record<'s3Key' | 'filename' | 'label', string> = {
  s3Key: 'deliveries/anton-2026-09-18/Eelathu-Manne-Karaoke-studio.mp3',
  filename: 'Eelathu Manne - Karaoke (studio).mp3',
  label: 'Anton — Eelathu Manne, studio',
};

export function DeliveryManager() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [form, setForm] = useState({ s3Key: '', filename: '', label: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await adminFetch('/api/admin/deliveries');
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not load delivery links.');
      setLoadError(null);
      setRows(body.deliveries ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
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
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/deliveries/${token}/revoke`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not revoke the link.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        {(['s3Key', 'filename', 'label'] as const).map((f) => (
          <div key={f}>
            <label htmlFor={`d-${f}`} className="block text-xs font-medium text-gray-600 dark:text-gray-300">
              {f === 's3Key' ? 'S3 key (must be under deliveries/)' : f === 'filename' ? 'Filename the buyer sees' : 'Label for your reference'}
            </label>
            <input
              id={`d-${f}`}
              value={form[f]}
              onChange={(e) => setForm((p) => ({ ...p, [f]: e.target.value }))}
              placeholder={PLACEHOLDERS[f]}
              // ⚠️ The placeholder colour is set EXPLICITLY. The browser default
              // is near-invisible on a white field and worse on a dark one, and
              // a hint nobody can read is not a hint. gray-500 clears 4.5:1 on
              // both grounds.
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-400"
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
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {created && (
          <input readOnly value={created} onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-emerald-300 bg-emerald-50 px-2 py-1 font-mono text-sm text-gray-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100" />
        )}
      </div>

      {loadError ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        : rows === null ? <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        : rows.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">No delivery links yet.</p>
        : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.token} className="flex flex-wrap items-center gap-3 rounded border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
              <span className="grow truncate text-gray-900 dark:text-gray-100">{r.label}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{r.filename}</span>
              <span className="tabular-nums text-xs text-gray-700 dark:text-gray-200">{r.downloadCount} / {r.maxDownloads}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{r.expiresAt.slice(0, 10)}</span>
              {r.revokedAt
                ? <span className="text-xs text-gray-400 dark:text-gray-500">revoked</span>
                : <button type="button" onClick={() => void revoke(r.token)}
                    className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">Revoke</button>}
              {/* The link itself, on every row. It used to appear once, in a box
                  after creation — close the tab before emailing it and the only
                  way back was minting a second link. */}
              {!r.revokedAt && (
                <input
                  readOnly
                  aria-label={`Delivery link for ${r.label}`}
                  value={r.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
