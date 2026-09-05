'use client';

/**
 * /admin/twitch — Twitch integration control panel (Phase 1).
 *
 * Two states:
 *   - DISCONNECTED: prominent [Connect Twitch] button
 *   - CONNECTED:    channel identity + connectedAt/updatedAt + [Reconnect] + [Disconnect]
 *
 * Also surfaces the outcome of the OAuth callback via query params
 * (?connected=1 or ?error=<code>) so a user returning from Twitch sees the
 * result without a page reload. The success/error banner auto-clears the
 * query params once acknowledged.
 *
 * Icon note: lucide-react 1.8.0 has no `Twitch` glyph — using `Radio` as a
 * live-broadcast proxy. When lucide-react ships an update, swap to Twitch.
 *
 * Thin by design — Phase 2 will add EventSub health + LIVE/OFFLINE badge on
 * this same page (see plan in project_ops_backlog memory).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Radio, CheckCircle2, AlertTriangle, Loader2, LogIn, LogOut, RefreshCcw, Bell, BellOff, Zap } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

interface Connection {
  twitchLogin: string;
  displayName: string;
  broadcasterId: string;
  profileImageUrl: string | null;
  scopes: string[];
  connectedAt: string;
  updatedAt: string;
}

interface EventSubSubscription {
  type: string;
  status: string;
  twitchSubscriptionId: string;
  createdAt: string;
  updatedAt: string;
  reason: string | null;
}

interface StreamState {
  isLive: boolean;
  streamId: string | null;
  title: string | null;
  categoryName: string | null;
  startedAt: string | null;
  updatedAt: string;
}

interface StatusResponse {
  success: boolean;
  status: 'connected' | 'disconnected' | 'revoked';
  connection: Connection | null;
  eventsub?: { subscriptions: EventSubSubscription[] };
  stream?: StreamState | null;
  error?: string;
}

/** Map the callback's error codes to human-friendly copy. */
const ERROR_COPY: Record<string, string> = {
  access_denied: 'You cancelled the Twitch authorization. Nothing was connected.',
  missing_state_or_code: 'The Twitch callback was missing required parameters. Please try again.',
  state_mismatch: 'The Twitch callback did not match the expected session (CSRF check failed). Please try again from this browser.',
  state_invalid: 'The Twitch callback used an expired or tampered session. Please try again.',
  exchange_failed: 'Twitch rejected the authorization code. Please try again.',
};

function formatIso(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toUTCString().replace(/^\w+, /, '');
}

export default function TwitchAdminPage() {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState<null | 'connect' | 'disconnect' | 'eventsub-enable' | 'eventsub-disable'>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/twitch/status');
      const body = (await res.json()) as StatusResponse;
      setStatus(body);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to read status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const err = search.get('error');
    const connected = search.get('connected');
    if (err) {
      setErrorMessage(ERROR_COPY[err] ?? `Twitch callback error: ${err}`);
      router.replace('/admin/twitch');
    } else if (connected === '1') {
      setSuccessMessage('Twitch connected.');
      router.replace('/admin/twitch');
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const onConnect = useCallback(async () => {
    setActionInFlight('connect');
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await adminFetch('/api/admin/twitch/connect', { method: 'POST' });
      const body = (await res.json()) as { success: boolean; url?: string; error?: string };
      if (!res.ok || !body.success || !body.url) {
        throw new Error(body.error || 'Could not start the Twitch connect flow.');
      }
      // Full-page redirect so the state cookie set by the API rides the browser navigation.
      window.location.assign(body.url);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setActionInFlight(null);
    }
  }, []);

  const onEnableEventSub = useCallback(async () => {
    setActionInFlight('eventsub-enable');
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await adminFetch('/api/admin/twitch/eventsub/enable', { method: 'POST' });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not enable EventSub.');
      setSuccessMessage('EventSub enabled. Twitch may take a few seconds to confirm each subscription.');
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInFlight(null);
    }
  }, [refresh]);

  const onDisableEventSub = useCallback(async () => {
    if (!window.confirm('Disable EventSub? Twitch will stop delivering stream events to this app until you re-enable.')) return;
    setActionInFlight('eventsub-disable');
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await adminFetch('/api/admin/twitch/eventsub/disable', { method: 'POST' });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not disable EventSub.');
      setSuccessMessage('EventSub disabled.');
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInFlight(null);
    }
  }, [refresh]);

  const onDisconnect = useCallback(async () => {
    if (!window.confirm('Disconnect Twitch? Your event history stays on file; tokens are wiped.')) return;
    setActionInFlight('disconnect');
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await adminFetch('/api/admin/twitch/disconnect', { method: 'POST' });
      const body = (await res.json()) as { success: boolean; error?: string };
      if (!res.ok || !body.success) {
        throw new Error(body.error || 'Could not disconnect Twitch.');
      }
      setSuccessMessage('Twitch disconnected.');
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInFlight(null);
    }
  }, [refresh]);

  const connected = useMemo(() => status?.status === 'connected' && status.connection, [status]);
  const eventsubActive = useMemo(() => {
    const subs = status?.eventsub?.subscriptions ?? [];
    if (subs.length === 0) return false;
    return subs.every((s) => s.status === 'enabled' || s.status === 'pending');
  }, [status]);
  const stream = status?.stream ?? null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="flex items-center gap-3 mb-2">
          <Radio className="w-8 h-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">Twitch</h1>
        </div>
        <p className="text-gray-600">
          Connect your Twitch channel so TamilAgaval can react to your live streams. Phase 1: connection + identity. Phase 2 adds LIVE/OFFLINE status and event feed.
        </p>
      </div>

      {errorMessage && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{successMessage}</span>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading connection status…
          </div>
        ) : connected && status?.connection ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {status.connection.profileImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={status.connection.profileImageUrl}
                  alt={`${status.connection.displayName} avatar`}
                  className="h-12 w-12 rounded-full"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center">
                  <Radio className="h-6 w-6 text-purple-600" aria-hidden="true" />
                </div>
              )}
              <div>
                <div className="font-semibold text-gray-900">{status.connection.displayName}</div>
                <div className="text-sm text-gray-500">@{status.connection.twitchLogin}</div>
              </div>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                Connected
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Broadcaster ID</dt>
                <dd className="font-mono text-gray-900">{status.connection.broadcasterId}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Scopes granted</dt>
                <dd className="text-gray-900">{status.connection.scopes.length === 0 ? '(none — Phase 1 baseline)' : status.connection.scopes.join(', ')}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Connected</dt>
                <dd className="text-gray-900">{formatIso(status.connection.connectedAt)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Last updated</dt>
                <dd className="text-gray-900">{formatIso(status.connection.updatedAt)}</dd>
              </div>
            </dl>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onConnect}
                disabled={actionInFlight !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                Reconnect
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                disabled={actionInFlight !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Disconnect
              </button>
            </div>
          </div>
        ) : status?.status === 'revoked' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Previously revoked — reconnect to restore
            </div>
            <button
              type="button"
              onClick={onConnect}
              disabled={actionInFlight !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Reconnect
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="inline-flex h-2 w-2 rounded-full bg-gray-300" aria-hidden="true" />
              Not connected
            </div>
            <button
              type="button"
              onClick={onConnect}
              disabled={actionInFlight !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {actionInFlight === 'connect' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogIn className="h-4 w-4" aria-hidden="true" />
              )}
              Connect Twitch
            </button>
            <p className="text-xs text-gray-500">
              You&apos;ll be redirected to Twitch, sign in, and approve the connection. TamilAgaval requests <strong>no scopes</strong> in Phase 1 — only your channel identity.
            </p>
          </div>
        )}
      </div>

      {/* EventSub panel — only shown when a connection exists. */}
      {connected && (
        <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-purple-600" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-gray-900">EventSub</h2>
            </div>
            {eventsubActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                <Bell className="h-3 w-3" aria-hidden="true" />
                Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                <BellOff className="h-3 w-3" aria-hidden="true" />
                Inactive
              </span>
            )}
          </div>

          {(status?.eventsub?.subscriptions ?? []).length === 0 ? (
            <p className="text-sm text-gray-600">
              No EventSub subscriptions yet. Enable to receive <code>stream.online</code> and <code>stream.offline</code> events, which drive the LIVE/OFFLINE panel below.
            </p>
          ) : (
            <ul className="text-sm space-y-1">
              {status?.eventsub?.subscriptions.map((s) => (
                <li key={s.type} className="flex items-center justify-between gap-2 rounded border border-gray-200 px-3 py-2">
                  <div className="flex-1">
                    <div className="font-mono text-gray-900">{s.type}</div>
                    {s.reason && <div className="text-xs text-amber-700">{s.reason}</div>}
                  </div>
                  <span
                    className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                      s.status === 'enabled'
                        ? 'bg-green-100 text-green-800'
                        : s.status === 'pending'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {s.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEnableEventSub}
              disabled={actionInFlight !== null}
              className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {actionInFlight === 'eventsub-enable' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Bell className="h-4 w-4" aria-hidden="true" />
              )}
              {eventsubActive ? 'Re-enable / Reconcile' : 'Enable EventSub'}
            </button>
            {eventsubActive && (
              <button
                type="button"
                onClick={onDisableEventSub}
                disabled={actionInFlight !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <BellOff className="h-4 w-4" aria-hidden="true" />
                Disable
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stream state — only shown when a connection exists. */}
      {connected && (
        <div className="bg-white rounded-lg shadow-sm p-6 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Stream</h2>
            {stream?.isLive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-red-800">
                <span className="inline-flex h-2 w-2 rounded-full bg-red-600 animate-pulse" aria-hidden="true" />
                LIVE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-gray-700">
                Offline
              </span>
            )}
          </div>
          {stream?.isLive ? (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {stream.title && (
                <>
                  <dt className="text-gray-500">Title</dt>
                  <dd className="text-gray-900">{stream.title}</dd>
                </>
              )}
              {stream.categoryName && (
                <>
                  <dt className="text-gray-500">Category</dt>
                  <dd className="text-gray-900">{stream.categoryName}</dd>
                </>
              )}
              {stream.startedAt && (
                <>
                  <dt className="text-gray-500">Started</dt>
                  <dd className="text-gray-900">{formatIso(stream.startedAt)}</dd>
                </>
              )}
              {stream.streamId && (
                <>
                  <dt className="text-gray-500">Stream ID</dt>
                  <dd className="font-mono text-gray-900">{stream.streamId}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-sm text-gray-600">
              {stream?.updatedAt
                ? <>Last state change: {formatIso(stream.updatedAt)}</>
                : eventsubActive
                  ? 'Waiting for the first stream event. Go live on Twitch and this panel will flip to LIVE.'
                  : 'Enable EventSub above to receive live/offline state.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
