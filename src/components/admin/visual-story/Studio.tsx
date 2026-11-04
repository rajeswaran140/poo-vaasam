'use client';

/**
 * /admin/visual-story/[vsId] — the studio (spec §10): scene rail on the left,
 * the selected scene's shot grid and the draft panel in the centre, the shot
 * inspector / characters panel on the right, spend and tiling along the bottom.
 *
 * One source of truth: after any mutation the whole tree is reloaded with one
 * GET, so spend, candidates and startSec always come from the server. The page
 * banner is for loading the story only; every control's error renders beside it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { adminFetch } from '@/lib/client-auth';
import type { Candidate, Character, Scene, Shot, StoryboardDraft, VisualStory } from '@/types/visualStory';
import { SceneRail } from './SceneRail';
import { ShotGrid } from './ShotGrid';
import { shotKey } from './ShotCard';
import { Inspector } from './Inspector';
import { CharactersPanel } from './CharactersPanel';
import { DraftPanel } from './DraftPanel';
import { SpendBar } from './SpendBar';

export interface StoryTree {
  story: VisualStory;
  scenes: Scene[];
  shots: Shot[];
  characters: Character[];
  candidates: Candidate[];
  drafts: StoryboardDraft[];
}

type Tab = 'inspector' | 'characters';

export function Studio({ vsId }: { vsId: string }) {
  const [tree, setTree] = useState<StoryTree | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sceneOrder, setSceneOrder] = useState<number | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inspector');
  // Only the newest reload may write state; an older, slower one must not undo it.
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}`);
      const body = await res.json().catch(() => null);
      if (mine !== seq.current) return;
      if (!res.ok || !body?.success) throw new Error(body?.error || 'Could not load this story.');
      setTree(body.data as StoryTree);
      setLoadError(null);
    } catch (err) {
      if (mine !== seq.current) return;
      setLoadError(err instanceof Error ? err.message : 'Could not load this story.');
    }
  }, [vsId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);

  const applied = useCallback((next: unknown) => {
    seq.current++; // supersede any reload already in flight
    setTree(next as StoryTree);
    setEditKey(null);
    setSceneOrder(null);
  }, []);

  if (!tree) {
    return loadError ? (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {loadError}
      </p>
    ) : (
      <p className="text-sm text-gray-600 dark:text-gray-400">Loading story…</p>
    );
  }

  const { story, scenes, shots, characters, candidates } = tree;
  const scene = scenes.find((s) => s.order === sceneOrder) ?? scenes[0] ?? null;
  const sceneShots = scene ? shots.filter((s) => s.sceneOrder === scene.order) : [];
  const editShot = shots.find((s) => shotKey(s) === editKey) ?? null;
  const tabClass = (on: boolean) =>
    `rounded-md px-3 py-1 text-sm ${on ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Link href="/admin/visual-story" className="text-sm text-blue-700 hover:underline dark:text-blue-400">
          ← All stories
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{story.title}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">{`${story.aspectRatio} · ${story.status}`}</p>
      </header>
      {loadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)_20rem]">
        <SceneRail
          vsId={vsId}
          scenes={scenes}
          shots={shots}
          selectedOrder={scene?.order ?? null}
          onSelect={setSceneOrder}
          onChanged={refresh}
        />

        <div className="space-y-6">
          <ShotGrid
            vsId={vsId}
            story={story}
            scene={scene}
            shots={sceneShots}
            characters={characters}
            candidates={candidates}
            selectedKey={editKey}
            onEdit={(key) => {
              setEditKey(key);
              setTab('inspector');
            }}
            onChanged={refresh}
          />
          <DraftPanel
            vsId={vsId}
            windowSec={story.windowEndSec - story.windowStartSec}
            sceneCount={scenes.length}
            shotCount={shots.length}
            onChanged={refresh}
            onApplied={applied}
          />
        </div>

        <aside className="space-y-3">
          <div role="tablist" aria-label="Inspector" className="flex gap-2">
            <button type="button" role="tab" aria-selected={tab === 'inspector'} onClick={() => setTab('inspector')} className={tabClass(tab === 'inspector')}>
              Shot
            </button>
            <button type="button" role="tab" aria-selected={tab === 'characters'} onClick={() => setTab('characters')} className={tabClass(tab === 'characters')}>
              Characters
            </button>
          </div>
          <div role="tabpanel">
            {tab === 'inspector' ? (
              <Inspector key={editKey ?? 'none'} vsId={vsId} shot={editShot} characters={characters} onChanged={refresh} />
            ) : (
              <CharactersPanel vsId={vsId} characters={characters} onChanged={refresh} />
            )}
          </div>
        </aside>
      </div>

      <SpendBar story={story} shots={shots} />
    </div>
  );
}
