'use client';

/**
 * ONE rendering of a release-checklist finding, for every screen that shows one.
 *
 * ⚠️ WHY THIS FILE EXISTS. `ReleaseChecker` used to declare its own local copy
 * of the severity union instead of importing it. Because it was a separate
 * declaration, TypeScript could not see the mismatch when `'not-checked'` was
 * added: the `Record` over the three old keys returned `undefined`, the code
 * read `.badge` off it, and the page crashed at runtime on a clean compile.
 * Two independent renderings of the same severity semantics are that defect
 * waiting to happen again — and the guarantee that rests on them is the one
 * that matters most: a check that did NOT RUN must never read as a pass.
 *
 * So the tone map is keyed off the imported `Severity`. Adding a fifth severity
 * is then a compile error HERE, in one place, rather than a silent `undefined`
 * in each screen that forgot.
 */

import { useState } from 'react';
import type { Finding, Severity } from '@/lib/release-checklist';

/**
 * How each severity is presented. `not-checked` is muted, dashed and italic on
 * purpose: it is NOT a pass (no green, no tick) and NOT a problem (no rose, no
 * amber) — it is the rule saying it never ran.
 */
export const FINDING_TONE: Record<Severity, { badge: string; label: string }> = {
  blocker: { badge: 'bg-rose-100 text-rose-800 border-rose-200', label: 'Blocker' },
  gap: { badge: 'bg-amber-100 text-amber-900 border-amber-200', label: 'Gap' },
  note: { badge: 'bg-gray-100 text-gray-700 border-gray-200', label: 'Note' },
  'not-checked': {
    badge: 'bg-slate-50 text-slate-400 border-slate-200 border-dashed italic',
    label: 'Not checked',
  },
};

/**
 * The three groups a findings list is shown in.
 *
 * `notChecked` is deliberately its own bucket rather than part of either other
 * one: it is neither a problem to fix (`actionable`) nor an opinion the rule
 * reached (`notes`). Filing it under `actionable` styles a check that never ran
 * as a defect; folding it into `notes` — or leaving it out — launders it as a
 * pass. Both have happened in this codebase.
 */
export interface GroupedFindings {
  actionable: Finding[];
  notes: Finding[];
  notChecked: Finding[];
}

/** Split findings into the three groups above. Pure; safe to call while rendering. */
export function groupFindings(findings: readonly Finding[] | undefined | null): GroupedFindings {
  const all = findings ?? [];
  return {
    actionable: all.filter((f) => f.severity !== 'note' && f.severity !== 'not-checked'),
    notes: all.filter((f) => f.severity === 'note'),
    notChecked: all.filter((f) => f.severity === 'not-checked'),
  };
}

/**
 * One finding row: severity badge, title, the Studio-only marker, the detail,
 * and — when the rule could generate concrete replacement text — the fix with a
 * copy button.
 */
export function FindingRow({ f }: { f: Finding }) {
  const [copied, setCopied] = useState(false);
  const tone = FINDING_TONE[f.severity];
  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${tone.badge}`}>
          {tone.label}
        </span>
        <span className="font-medium text-gray-900">{f.title}</span>
        {f.manual && (
          <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600">
            Studio only
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-600">{f.detail}</p>
      {f.fix && (
        <div className="mt-2 flex items-start gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-gray-50 px-2 py-1 text-xs text-gray-800">
            {f.fix}
          </code>
          <button
            type="button"
            className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(f.fix as string);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked — the text is selectable anyway */
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}
    </li>
  );
}
