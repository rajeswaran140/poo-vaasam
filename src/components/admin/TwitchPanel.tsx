'use client';

/**
 * Twitch integration panel for /admin/twitch.
 *
 * Read-only status plus three actions: Connect, Reconnect, Disconnect. All
 * decisions are server-side (GET /api/admin/twitch/status); this only renders
 * what it is given, and it never receives a token — the status route returns an
 * explicit allow-list of fields.
 *
 * Deliberately shows the UNHAPPY states as clearly as the happy one: a
 * degraded connection or a revoked EventSub subscription is exactly what an
 * integration panel exists to surface, and silence would look like health.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Radio, Link2, Unlink, AlertTriangle } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

interface TwitchStatus {
  configured: boolean;
  missing?: string[];
  connection: {
    twitchLogin: string;
    displayName: string;
    broadcasterId: string;
    profileImageUrl?: string;
    status: string;
    scopes: string[];
    connectedAt: string;
    updatedAt: string;
    lastError?: string;
  } | null;
  live?: boolean;
  stream?: {
    streamId?: string;
    title?: string;
    categoryName?: string;
    startedAt?: string;
    viewerCount?: number;
  } | null;
  eventSub?: {
    subscriptions: { type: string; status: string; createdAt: string }[];
    active: boolean;
  };
  lastEvent?: { eventType: string; receivedAt: string } | null;
  error?: string;
}

/** Callback outcomes, translated for a human. */
const CALLBACK_MESSAGES: Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  connected: { tone: 'ok', text: 'Twitch connected.' },
  denied: { tone: 'warn', text: 'Authorization was declined at Twitch.' },
  invalid_state: {
    tone: 'error',
    text: 'That connect link had expired. Start the connection again.',
  },
  missing_code: { tone: 'error', text: 'Twitch did not return an authorization code.' },
  rejected: { tone: 'error', text: 'Twitch rejected the authorization. Try connecting again.' },
  not_configured: { tone: 'error', text: 'Twitch is not configured on this environment.' },
  error: { tone: 'error', text: 'Could not complete the Twitch connection.' },
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <span className="text-sm text-gray-900 dark:text-gray-100 text-right">{children}</span>
    </div>
  );
}

export default function TwitchPanel() {
  const [status, setStatus] = useState<TwitchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callbackResult, setCallbackResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/twitch/status');
      const data = (await res.json()) as TwitchStatus;
      if (!res.ok && !data.configured) setError(data.error ?? 'Could not load Twitch status');
      setStatus(data);
    } catch {
      setError('Could not load Twitch status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Surface the ?status= the OAuth callback redirected back with, then strip
    // it so a refresh doesn't keep re-announcing an old outcome.
    const params = new URLSearchParams(window.location.search);
    const s = params.get('status');
    if (s) {
      setCallbackResult(s);
      window.history.replaceState({}, '', window.location.pathname);
    }
    void load();
  }, [load]);

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const res = await adminFetch('/api/admin/twitch/connect');
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setError(data?.error ?? 'Could not start the Twitch connection');
    } catch {
      setError('Could not start the Twitch connection');
    } finally {
      setBusy(null);
    }
  };

  const act = async (path: string, label: string) => {
    setBusy(label);
    setError(null);
    try {
      const res = await adminFetch(path, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setError(data?.error ?? `${label} failed`);
      await load();
    } catch {
      setError(`${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const banner = callbackResult ? CALLBACK_MESSAGES[callbackResult] : null;

  return (
    <div className="space-y-4">
      {banner && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            banner.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200'
              : banner.tone === 'warn'
                ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200'
                : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200'
          }`}
        >
          {banner.text}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <Radio className="h-4 w-4" /> Twitch
          </h2>
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        {loading && !status && (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        )}

        {status && !status.configured && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-4 w-4" /> Not configured
            </p>
            {status.missing?.length ? (
              <p className="mt-1 text-xs">
                Missing: <code>{status.missing.join(', ')}</code>. These must be set in the
                Amplify console <em>and</em> listed in <code>next.config.ts</code>, then
                redeployed — see <code>docs/TWITCH_INTEGRATION.md</code>.
              </p>
            ) : null}
          </div>
        )}

        {status?.configured && !status.connection && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              No Twitch account is connected.
            </p>
            <button
              onClick={() => void connect()}
              disabled={busy === 'connect'}
              className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <Link2 className="h-4 w-4" />
              {busy === 'connect' ? 'Opening Twitch…' : 'Connect Twitch'}
            </button>
          </div>
        )}

        {status?.configured && status.connection && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {status.connection.profileImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={status.connection.profileImageUrl}
                  alt=""
                  className="h-10 w-10 rounded-full"
                />
              )}
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {status.connection.displayName}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  @{status.connection.twitchLogin}
                </div>
              </div>
              <span
                className={`ml-auto rounded-full px-2.5 py-1 text-xs font-semibold ${
                  status.live
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {status.live ? 'LIVE ON TWITCH' : 'Offline'}
              </span>
            </div>

            {status.connection.status !== 'connected' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                <span className="font-medium">Connection {status.connection.status}</span>
                {status.connection.lastError ? ` — ${status.connection.lastError}` : ''}
                {status.connection.status === 'reauth_required' &&
                  ' Reconnecting requires authorizing at Twitch again.'}
              </div>
            )}

            {status.live && status.stream && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2">
                <StatusRow label="Title">{status.stream.title ?? '—'}</StatusRow>
                <StatusRow label="Category">{status.stream.categoryName ?? '—'}</StatusRow>
                <StatusRow label="Started">{fmtDate(status.stream.startedAt)}</StatusRow>
                <StatusRow label="Viewers">
                  {status.stream.viewerCount != null ? status.stream.viewerCount : '—'}
                </StatusRow>
                <StatusRow label="Stream ID">
                  <code className="text-xs">{status.stream.streamId ?? '—'}</code>
                </StatusRow>
              </div>
            )}

            <div className="border-t border-gray-100 dark:border-gray-800 pt-2">
              <StatusRow label="Connected">{fmtDate(status.connection.connectedAt)}</StatusRow>
              <StatusRow label="Scopes">
                {status.connection.scopes.length ? status.connection.scopes.join(', ') : 'none'}
              </StatusRow>
              <StatusRow label="EventSub">
                {status.eventSub?.active ? (
                  <span className="text-emerald-700 dark:text-emerald-300">Active</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-300">Not active</span>
                )}
              </StatusRow>
              {status.eventSub?.subscriptions.map((s) => (
                <StatusRow key={s.type} label={s.type}>
                  <span
                    className={
                      s.status === 'enabled'
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-amber-700 dark:text-amber-300'
                    }
                  >
                    {s.status}
                  </span>
                </StatusRow>
              ))}
              <StatusRow label="Last event">
                {status.lastEvent
                  ? `${status.lastEvent.eventType} · ${fmtDate(status.lastEvent.receivedAt)}`
                  : 'none yet'}
              </StatusRow>
            </div>

            <div className="flex gap-2 pt-1">
              {status.connection.status === 'reauth_required' ? (
                <button
                  onClick={() => void connect()}
                  disabled={busy === 'connect'}
                  className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  <Link2 className="h-4 w-4" /> Reauthorize
                </button>
              ) : (
                <button
                  onClick={() => void act('/api/admin/twitch/reconnect', 'Reconnect')}
                  disabled={busy === 'Reconnect'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  {busy === 'Reconnect' ? 'Reconnecting…' : 'Reconnect'}
                </button>
              )}
              <button
                onClick={() => void act('/api/admin/twitch/disconnect', 'Disconnect')}
                disabled={busy === 'Disconnect'}
                className="inline-flex items-center gap-1.5 rounded-md border border-red-200 dark:border-red-900/50 px-3 py-1.5 text-sm text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
              >
                <Unlink className="h-4 w-4" />
                {busy === 'Disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
