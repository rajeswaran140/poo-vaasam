'use client';

/**
 * Bottom bar: spend against the cap (and the Budget field that edits the cap),
 * how much of the window the shots fill, and how many have a chosen image.
 * The route refuses a cap below what is spent or reserved (409); that message
 * shows next to the field.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import type { Shot, VisualStory } from '@/types/visualStory';
import { usd } from './ShotCard';

const MAX_BUDGET_USD = 500;

interface Props {
  vsId: string;
  story: VisualStory;
  shots: Shot[];
  onChanged: () => void;
}

export function SpendBar({ vsId, story, shots, onChanged }: Props) {
  const [budget, setBudget] = useState(String(story.budgetUsdCap));
  const [saving, setSaving] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const budgetNum = Number(budget);
  const budgetOk = budget.trim() !== '' && Number.isFinite(budgetNum) && budgetNum >= 0 && budgetNum <= MAX_BUDGET_USD;

  const saveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budgetOk || saving) return;
    setSaving(true);
    setBudgetError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetUsdCap: budgetNum }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setBudgetError(body?.error || 'Could not change the budget.');
        return;
      }
      onChanged();
    } catch {
      setBudgetError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const windowSec = story.windowEndSec - story.windowStartSec;
  const totalSec = shots.reduce((t, s) => t + s.durationSec, 0);
  const tiles = totalSec === windowSec;
  const chosen = shots.filter((s) => s.selectedCandidateId).length;
  const cap = story.budgetUsdCap;
  const pct = (n: number) => (cap > 0 ? Math.min(100, (n / cap) * 100) : 100);

  return (
    <footer aria-label="Spend and timeline" className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-gray-200 bg-white px-4 py-3 text-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="min-w-[16rem] space-y-1">
        <p className="text-gray-800 dark:text-gray-200">{`${usd(story.spentUsd)} spent + ${usd(story.reservedUsd)} reserved of ${usd(cap)}`}</p>
        <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
          <div className="bg-blue-600" style={{ width: `${pct(story.spentUsd)}%` }} />
          <div className="bg-amber-500" style={{ width: `${pct(story.reservedUsd)}%` }} />
        </div>
      </div>
      <form onSubmit={saveBudget} className="flex flex-wrap items-end gap-2">
        <label className="text-gray-700 dark:text-gray-300">
          Budget (USD)
          <input
            type="number"
            min={0}
            max={MAX_BUDGET_USD}
            step={0.01}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className="ml-2 w-24 rounded-md border border-gray-300 px-2 py-0.5 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <button type="submit" disabled={!budgetOk || saving} className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200">
          {saving ? 'Saving…' : 'Save budget'}
        </button>
        {budgetError && (
          <p role="alert" className="basis-full text-red-600 dark:text-red-400">
            {budgetError}
          </p>
        )}
      </form>
      <p className={tiles ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}>
        <span>{`Shots fill ${totalSec} of ${windowSec} s`}</span>
        {!tiles && <span className="text-gray-600 dark:text-gray-400">{' — they must fill the window exactly to render'}</span>}
      </p>
      <p className="text-gray-700 dark:text-gray-300">{`${chosen} of ${shots.length} shots have a chosen image`}</p>
    </footer>
  );
}
