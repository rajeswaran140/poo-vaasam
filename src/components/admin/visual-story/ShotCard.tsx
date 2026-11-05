'use client';

/**
 * One shot in the grid: mode badge, prompt, cast, its span on the window, the
 * cost estimate, "Generate still" behind a confirm-before-spend dialog (spec
 * §11 layer 2), and the candidate strip with a radio for the chosen image.
 *
 * Every error from this card's own requests (402 over budget, 422 content
 * policy, 503 not connected, 502 upstream…) renders HERE, beside the button
 * that caused it — never in a page banner.
 */

import { useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { estimateCostUsd } from '@/services/video/cost';
import type { Candidate, Character, Shot, ShotMode, VisualStory } from '@/types/visualStory';
import { formatMss } from './WindowPicker';

export const usd = (n: number) => `$${n.toFixed(2)}`;

/** `nnn-mmm`, the shot key the still route takes. */
export const shotKey = (s: Pick<Shot, 'sceneOrder' | 'shotOrder'>) =>
  `${String(s.sceneOrder).padStart(3, '0')}-${String(s.shotOrder).padStart(3, '0')}`;

/** The STILL route always bills the Grok image rate, whatever the story's provider. */
export const STILL_PRICE_USD = estimateCostUsd('grok', 'STILL', 1);

/** A short-lived signed URL for a private workspace object, via the mastering download route. */
export function usePlayUrl(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setUrl(null);
    void (async () => {
      try {
        const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(key)}&mode=play`);
        const body = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && body.success && body.url) setUrl(body.url as string);
      } catch {
        // A preview is a convenience; a failed presign leaves the box empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return url;
}

export function Thumb({ s3Key, alt }: { s3Key: string; alt: string }) {
  const url = usePlayUrl(s3Key);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className="h-16 w-16 rounded object-cover" />
  ) : (
    <span className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-400">
      …
    </span>
  );
}

function ModeBadge({ mode }: { mode: ShotMode }) {
  if (mode === 'HERO') {
    return <span className="rounded px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">{mode}</span>;
  }
  if (mode === 'MOTION') {
    return <span className="rounded px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">{mode}</span>;
  }
  return <span className="rounded px-2 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200">{mode}</span>;
}

interface Props {
  vsId: string;
  shot: Shot;
  story: VisualStory;
  characters: Character[];
  candidates: Candidate[];
  selected: boolean;
  onEdit: () => void;
  /** Reload the story tree (spend, candidates) after any request settles. */
  onChanged: () => void;
}

export function ShotCard({ vsId, shot, story, characters, candidates, selected, onEdit, onChanged }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State updates are async; the ref closes the gap between two fast clicks.
  const inFlight = useRef(false);

  const key = shotKey(shot);
  const label = `Shot ${shot.sceneOrder}.${shot.shotOrder}`;
  const committed = story.spentUsd + story.reservedUsd;
  const after = committed + STILL_PRICE_USD;
  const overCap = after > story.budgetUsdCap + 1e-9;
  const cast = shot.charIds
    .map((id) => characters.find((c) => c.charId === id))
    .filter((c): c is Character => !!c);

  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setConfirming(false);
    setPending(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots/${key}/still`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) setError(body?.error || `Could not generate the still (HTTP ${res.status}).`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setPending(false);
      // Spend moves on success AND on a billed refusal, so always reload.
      onChanged();
    }
  };

  const pick = async (candId: string) => {
    if (picking) return;
    setPicking(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneOrder: shot.sceneOrder, shotOrder: shot.shotOrder, candId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) setError(body?.error || 'Could not choose that image.');
      else onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPicking(false);
    }
  };

  return (
    <article
      aria-label={label}
      className={`space-y-2 rounded-lg border p-3 ${selected ? 'border-blue-500 dark:border-blue-400' : 'border-gray-200 dark:border-gray-700'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ModeBadge mode={shot.mode} />
          <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        </div>
        <span className="text-xs text-gray-600 dark:text-gray-400">{`${formatMss(shot.startSec)}–${formatMss(shot.startSec + shot.durationSec)}`}</span>
      </div>

      <p className="text-sm text-gray-800 dark:text-gray-200">{shot.visualPrompt}</p>

      {cast.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {cast.map((c) => (
            <li key={c.charId} className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800 dark:bg-purple-900 dark:text-purple-200">
              {c.name}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span>{`${shot.durationSec} s · estimate ${usd(estimateCostUsd('grok', shot.mode, shot.durationSec))} as ${shot.mode}`}</span>
        <button type="button" onClick={onEdit} className="text-blue-700 hover:underline dark:text-blue-400">
          Edit
        </button>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => !pending && setConfirming(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Generating…' : `Generate still (${usd(STILL_PRICE_USD)})`}
        </button>
        {confirming && (
          <div role="dialog" aria-label={`Confirm still for ${label}`} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-gray-800 dark:text-gray-200">{`Generate one still image for ${usd(STILL_PRICE_USD)}?`}</p>
            <p className="text-gray-600 dark:text-gray-400">{`Story total after this: ${usd(after)} of ${usd(story.budgetUsdCap)}`}</p>
            {overCap && <p className="text-red-600 dark:text-red-400">That is over this story&apos;s budget cap.</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={generate}
                disabled={overCap}
                className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
              >
                Confirm
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
                Cancel
              </button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      {candidates.length > 0 && (
        <fieldset disabled={picking} className="flex flex-wrap gap-2">
          <legend className="sr-only">{`Chosen image for ${label}`}</legend>
          {candidates.map((c, i) => (
            <label key={c.candId} className="flex flex-col items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
              <Thumb s3Key={c.s3Key} alt={`Candidate ${i + 1} for ${label}`} />
              <input
                type="radio"
                name={`pick-${key}`}
                aria-label={`Image ${i + 1}`}
                checked={shot.selectedCandidateId === c.candId}
                onChange={() => pick(c.candId)}
              />
            </label>
          ))}
        </fieldset>
      )}
    </article>
  );
}
