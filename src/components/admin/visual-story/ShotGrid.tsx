'use client';

/** Centre region: the selected scene's shots as cards, plus "Add shot". */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { MAX_SHOT_SEC, MIN_SHOT_SEC } from '@/types/visualStory';
import type { Candidate, Character, GenJob, Scene, Shot, VisualStory } from '@/types/visualStory';
import { ShotCard } from './ShotCard';
import { shotKey } from './ui-utils';

interface Props {
  vsId: string;
  story: VisualStory;
  scene: Scene | null;
  shots: Shot[];
  characters: Character[];
  candidates: Candidate[];
  genJobs: GenJob[];
  selectedKey: string | null;
  onEdit: (key: string) => void;
  onChanged: () => void;
}

export function ShotGrid({ vsId, story, scene, shots, characters, candidates, genJobs, selectedKey, onEdit, onChanged }: Props) {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState('5');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!scene) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
        No scenes yet. Draft a storyboard from the lyrics below, or add a scene.
      </p>
    );
  }

  const durNum = Number(duration);
  const canAdd = prompt.trim() !== '' && Number.isInteger(durNum) && durNum >= MIN_SHOT_SEC && durNum <= MAX_SHOT_SEC && !busy;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'create', sceneOrder: scene.order, mode: 'STILL', durationSec: durNum, visualPrompt: prompt.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || 'Could not add the shot.');
        return;
      }
      setPrompt('');
      onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Shots in ${scene.heading}`} className="space-y-3">
      <header>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{scene.heading}</h2>
        {scene.summary && <p className="text-sm text-gray-600 dark:text-gray-400">{scene.summary}</p>}
      </header>

      {shots.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">This scene has no shots yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {shots.map((s) => {
          const key = shotKey(s);
          return (
            <ShotCard
              key={key}
              vsId={vsId}
              shot={s}
              story={story}
              characters={characters}
              candidates={candidates.filter((c) => c.sceneOrder === s.sceneOrder && c.shotOrder === s.shotOrder)}
              jobs={genJobs.filter((j) => j.sceneOrder === s.sceneOrder && j.shotOrder === s.shotOrder)}
              selected={selectedKey === key}
              onEdit={() => onEdit(key)}
              onChanged={onChanged}
            />
          );
        })}
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <label className="flex-1 text-sm text-gray-700 dark:text-gray-300">
          New shot prompt
          <input
            type="text"
            value={prompt}
            maxLength={2000}
            onChange={(e) => setPrompt(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">
          Seconds
          <input
            type="number"
            min={MIN_SHOT_SEC}
            max={MAX_SHOT_SEC}
            step={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="mt-1 block w-20 rounded-md border border-gray-300 px-2 py-1 dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        <button type="submit" disabled={!canAdd} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200">
          {busy ? 'Adding…' : 'Add shot'}
        </button>
        {error && (
          <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
