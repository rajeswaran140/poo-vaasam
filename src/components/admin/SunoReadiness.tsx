'use client';

/**
 * SunoReadiness — pre-flight panel shown under each SUNO style variant in the
 * composer. Runs the FREE deterministic linter (src/lib/suno-preflight.ts) on
 * every render (instant, no cost) and, on demand, an LLM critic
 * (/api/admin/suno-critic) for semantic risks — so a credit is only spent on a
 * vetted prompt.
 */

import { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, AlertTriangle, Info, Sparkles, Loader2 } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { preflightSuno, type Severity } from '@/lib/suno-preflight';
import type { SunoCritique } from '@/services/ai/sunoCritic';

const SEV_ICON: Record<Severity, typeof Info> = { error: ShieldAlert, warning: AlertTriangle, info: Info };
const SEV_COLOR: Record<Severity, string> = {
  error: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-gray-500 dark:text-gray-400',
};

export function SunoReadiness({ style, lyrics, targetSeconds }: { style: string; lyrics: string; targetSeconds?: number }) {
  const result = useMemo(() => preflightSuno({ style, lyrics, targetSeconds }), [style, lyrics, targetSeconds]);
  const [critique, setCritique] = useState<SunoCritique | null>(null);
  const [critiquing, setCritiquing] = useState(false);
  const [critErr, setCritErr] = useState<string | null>(null);

  const runCritic = async () => {
    setCritiquing(true);
    setCritErr(null);
    try {
      const res = await adminFetch('/api/admin/suno-critic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style, lyrics }),
      });
      const json = await res.json();
      if (json.success) setCritique(json.critique);
      else setCritErr(json.error || 'Critic failed');
    } catch {
      setCritErr('Critic failed');
    } finally {
      setCritiquing(false);
    }
  };

  const ReadyBadge = result.ready ? ShieldCheck : ShieldAlert;
  const badgeColor = result.ready
    ? result.findings.length === 0
      ? 'text-green-600 dark:text-green-400'
      : 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400';

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900/50">
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 font-semibold ${badgeColor}`}>
          <ReadyBadge className="h-4 w-4" />
          {result.ready ? (result.findings.length ? 'Ready (with notes)' : 'Ready to generate') : 'Not ready — fix errors first'}
          <span className="ml-1 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {result.score}/100
          </span>
        </span>
        <button
          type="button"
          onClick={runCritic}
          disabled={critiquing}
          className="inline-flex items-center gap-1.5 rounded-full border border-purple-300 px-2.5 py-1 font-medium text-purple-700 hover:bg-purple-50 disabled:opacity-50 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-950/40"
        >
          {critiquing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          AI critic
        </button>
      </div>

      {result.findings.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {result.findings.map((f, i) => {
            const Icon = SEV_ICON[f.severity];
            return (
              <li key={`${f.code}-${i}`} className="flex items-start gap-1.5">
                <Icon className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${SEV_COLOR[f.severity]}`} />
                <span className="text-gray-700 dark:text-gray-300">
                  <span className="font-medium">{f.message}</span>
                  {f.fix && <span className="text-gray-500 dark:text-gray-400"> — {f.fix}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {critErr && <p className="mt-2 text-red-600 dark:text-red-400">⚠️ {critErr}</p>}

      {critique && (
        <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
          <p className="font-semibold text-purple-700 dark:text-purple-300">
            AI critic: {critique.verdict.replace('_', ' ')} — <span className="font-normal text-gray-600 dark:text-gray-400">{critique.summary}</span>
          </p>
          {critique.issues.length > 0 && (
            <ul className="mt-1.5 space-y-1.5">
              {critique.issues.map((it, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className={`mt-0.5 text-[10px] font-bold uppercase ${it.severity === 'high' ? 'text-red-600' : it.severity === 'medium' ? 'text-amber-600' : 'text-gray-500'}`}>
                    {it.severity}
                  </span>
                  <span className="text-gray-700 dark:text-gray-300">
                    <span className="font-medium">{it.title}.</span> {it.detail}{' '}
                    <span className="text-gray-500 dark:text-gray-400">→ {it.fix}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
