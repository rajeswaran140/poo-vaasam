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
import { Radio, CheckCircle2, AlertTriangle, Loader2, LogIn, LogOut, RefreshCcw } from 'lucide-react';
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

interface StatusResponse {
  success: boolean;
  status: 'connected' | 'disconnected' | 'revoked';
  connection: Connection | null;
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
  const [actionInFlight, setActionInFlight] = useState<null | 'connect' | 'disconnect'>(null);
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
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="inline-flex h-2 w-2 rounded-full bg-gray-300" aria-hidden="true" />
              Not connected
              {status?.status === 'revoked' && <span className="text-amber-700">(previously revoked — reconnect to restore)</span>}
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
    </div>
  );
}
