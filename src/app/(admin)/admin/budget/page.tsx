'use client';

/**
 * /admin/budget — what Tamilagaval costs to run.
 *
 * ⚠️ EVERY FIGURE SHOWS ITS BASIS, and that is the point of the page rather
 * than a nicety. Attributing this bill by hand first produced $16.49, which
 * was wrong: it assumed Amplify and Route 53 were entirely ours when the
 * account carries five Amplify apps and six hosted zones across talky,
 * techsynergy, crowvault and mobily. A single opaque total is exactly what
 * made that error invisible, so each line here is rendered with the sentence
 * explaining how it was derived, and estimates are marked as estimates.
 *
 * Scoped to Tamilagaval only, deliberately — the other projects on this
 * account are out of scope until asked for.
 */

import { useEffect, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { httpErrorMessage } from '@/lib/http-error-message';

interface Line {
  service: string;
  cost: number;
  total: number;
  basis: string;
  exact: boolean;
}

interface Summary {
  lines: Line[];
  tamilagaval: number;
  accountTotal: number;
  sharePct: number;
  allExact: boolean;
}

interface Payload {
  success: boolean;
  configured: boolean;
  error?: string;
  cached?: boolean;
  period?: { Start: string; End: string };
  summary?: Summary;
}

const money = (n: number) => `$${n.toFixed(2)}`;

export default function BudgetPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const res = await adminFetch('/api/admin/budget?months=3', { signal: controller.signal });
        if (!res.ok) throw new Error(httpErrorMessage(res.status));
        const json = (await res.json()) as Payload;
        if (!controller.signal.aborted) setPayload(json);
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setErr(e instanceof Error ? e.message : 'Failed to load cost data');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const s = payload?.summary;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-28">
      <h1 className="font-tamil text-3xl font-bold text-white">Budget — Tamilagaval</h1>
      <p className="mt-2 text-sm text-gray-400">
        What this project costs to run, separated from everything else on the AWS account.
      </p>

      {loading && <p className="mt-8 text-gray-400">Loading…</p>}

      {err && (
        <p role="alert" className="mt-8 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-300">
          {err}
        </p>
      )}

      {/* Not a failure — a configuration state. Say what to do about it. */}
      {payload && !payload.configured && (
        <div className="mt-8 rounded-lg border border-amber-500/40 bg-amber-500/10 p-5">
          <h2 className="font-semibold text-amber-200">Cost Explorer is not readable yet</h2>
          <p className="mt-2 text-sm text-gray-300">{payload.error}</p>
          <pre className="mt-3 overflow-x-auto rounded bg-black/40 p-3 text-xs text-gray-300">
{`aws iam attach-user-policy \\
  --user-name poo-vaasam-app-user \\
  --policy-arn <arn of a policy allowing ce:GetCostAndUsage>`}
          </pre>
        </div>
      )}

      {s && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <Stat label="Tamilagaval, this month" value={money(s.tamilagaval)} accent />
            <Stat label="Whole AWS account" value={money(s.accountTotal)} />
            <Stat label="Tamilagaval's share" value={`${s.sharePct.toFixed(1)}%`} />
          </div>

          <h2 className="mt-10 font-semibold text-white">How that figure is built</h2>
          <p className="mb-3 text-sm text-gray-400">
            Each line shows how it was attributed. Nothing here is a hardcoded share.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-4">Service</th>
                  <th className="py-2 pr-4 text-right">Ours</th>
                  <th className="py-2 pr-4 text-right">Line total</th>
                  <th className="py-2">Basis</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.service} className="border-b border-gray-800 align-top">
                    <td className="py-2 pr-4 text-gray-200">{l.service}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-white">{money(l.cost)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-gray-400">{money(l.total)}</td>
                    <td className="py-2 text-gray-400">
                      {l.basis}
                      {!l.exact && (
                        <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                          estimate
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!s.allExact && (
            <p className="mt-4 text-xs text-gray-500">
              At least one line is a share rather than a measured figure, so the total is an
              estimate. The basis column says which.
            </p>
          )}

          <p className="mt-6 text-xs text-gray-600">
            {payload?.cached ? 'Served from cache (refreshes every 12h).' : 'Freshly queried.'} Cost
            Explorer bills $0.01 per query, so this page is cached rather than live.
          </p>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/60 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-orange-400' : 'text-white'}`}>
        {value}
      </div>
    </div>
  );
}
