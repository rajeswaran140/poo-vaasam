'use client';

/**
 * /admin/visual-story/[vsId] — the studio (spec §10): scene rail on the left,
 * the selected scene's shot grid and the draft panel in the centre, the shot
 * inspector / characters panel on the right, spend and tiling along the bottom;
 * the render panel under the title joins the chosen pictures and clips with
 * the song (Phase 6).
 *
 * One source of truth: after any mutation the whole tree is reloaded with one
 * GET, so spend, candidates and startSec always come from the server. The page
 * banner is for loading the story only; every control's error renders beside it.
 *
 * Phones: the columns stack, so Edit scrolls the shot panel into view, and a
 * story with no shots shows the draft panel (the first step) above the grid.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { adminFetch } from '@/lib/client-auth';
import type { Candidate, Character, DraftJob, GenJob, RenderJob, Scene, Shot, StoryboardDraft, VisualStory } from '@/types/visualStory';
import { SceneRail } from './SceneRail';
import { ShotGrid } from './ShotGrid';
import { shotKey } from './ui-utils';
import { Inspector } from './Inspector';
import { CharactersPanel } from './CharactersPanel';
import { CheckPanel } from './CheckPanel';
import { BatchPanel } from './BatchPanel';
import { PicturePanel } from './PicturePanel';
import { DraftPanel } from './DraftPanel';
import { SpendBar } from './SpendBar';
import { StoryActions } from './StoryActions';
import { RenderPanel } from './RenderPanel';
import { StyleField } from './StyleField';
import { StepsBar } from './StepsBar';
import { TimelineStrip } from './TimelineStrip';
import { storyProgress } from '@/lib/visual-story-progress';

export interface StoryTree {
  story: VisualStory;
  scenes: Scene[];
  shots: Shot[];
  characters: Character[];
  candidates: Candidate[];
  drafts: StoryboardDraft[];
  /** Draft jobs; a queued|running one is followed by the draft panel after a reload. */
  draftJobs?: DraftJob[];
  /** Video jobs; a submitted|running one resumes polling in its shot card. */
  genJobs?: GenJob[];
  /** Assemblies of the timeline (Phase 6); the newest shows in the render panel. */
  renders?: RenderJob[];
}

type Tab = 'inspector' | 'characters';

/** Below Tailwind's lg the three columns stack and the shot panel sits under everything. */
const STACKED_QUERY = '(max-width: 1023px)';

export function Studio({ vsId }: { vsId: string }) {
  const [tree, setTree] = useState<StoryTree | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sceneOrder, setSceneOrder] = useState<number | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('inspector');
  // Bumped on every Edit press, so pressing Edit on the same shot scrolls again.
  const [editNonce, setEditNonce] = useState(0);
  const asideRef = useRef<HTMLElement>(null);
  const router = useRouter();
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

  useEffect(() => {
    if (editNonce === 0) return;
    if (!window.matchMedia?.(STACKED_QUERY)?.matches) return;
    asideRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [editNonce]);

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
  // ISO timestamps sort as strings; the newest paid draft is shown on load.
  const lastDraft = [...(tree.drafts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const tabClass = (on: boolean) =>
    `min-h-11 rounded-md px-3 py-1 text-sm lg:min-h-0 ${on ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`;

  const shotGrid = (
    <ShotGrid
      key="grid"
      vsId={vsId}
      story={story}
      scene={scene}
      shots={sceneShots}
      characters={characters}
      candidates={candidates}
      genJobs={tree.genJobs ?? []}
      selectedKey={editKey}
      onEdit={(key) => {
        setEditKey(key);
        setTab('inspector');
        setEditNonce((n) => n + 1);
      }}
      onChanged={refresh}
    />
  );
  const draftPanel = (
    <DraftPanel
      key="draft"
      vsId={vsId}
      windowSec={story.windowEndSec - story.windowStartSec}
      sceneCount={scenes.length}
      shotCount={shots.length}
      lastDraft={lastDraft}
      liveJobId={(tree.draftJobs ?? []).find((j) => j.status === 'queued' || j.status === 'running')?.jobId ?? null}
      onChanged={refresh}
      onApplied={applied}
    />
  );

  const checkPanel = (
    <CheckPanel
      key="check"
      vsId={vsId}
      story={story}
      scenes={scenes}
      shots={shots}
      characters={characters}
      onOpen={(sceneOrder, shotOrder) => {
        setSceneOrder(sceneOrder);
        const target = shots.find((s) => s.sceneOrder === sceneOrder && s.shotOrder === shotOrder);
        if (!target) return;
        setEditKey(shotKey(target));
        setTab('inspector');
        setEditNonce((n) => n + 1);
      }}
      onChanged={refresh}
    />
  );

  const picturePanel = (
    <PicturePanel
      key="pictures"
      vsId={vsId}
      story={story}
      scenes={scenes}
      shots={shots}
      candidates={candidates}
      genJobs={tree.genJobs ?? []}
      characters={characters}
      onChanged={refresh}
    />
  );

  const batchPanel = (
    <BatchPanel
      key="batch"
      vsId={vsId}
      story={story}
      shots={shots}
      candidates={candidates}
      genJobs={tree.genJobs ?? []}
      onChanged={refresh}
    />
  );

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <Link href="/admin/visual-story" className="text-sm text-blue-700 hover:underline dark:text-blue-400">
          ← All stories
        </Link>
        <StoryActions
          vsId={vsId}
          title={story.title}
          shotCount={shots.length}
          onChanged={refresh}
          onDeleted={() => router.push('/admin/visual-story')}
        />
        <p className="text-sm text-gray-600 dark:text-gray-400">{`${story.aspectRatio} · ${story.status}`}</p>
        <StyleField vsId={vsId} style={story.style ?? ''} onChanged={refresh} />
      </header>
      <StepsBar progress={storyProgress({ story, shots, candidates, renders: tree.renders ?? [] })} />
      <TimelineStrip
        shots={shots}
        candidates={candidates}
        aspect={story.aspectRatio}
        selectedKey={editKey}
        onOpen={(s) => {
          setSceneOrder(s.sceneOrder);
          setEditKey(shotKey(s));
          setTab('inspector');
          setEditNonce((n) => n + 1);
        }}
      />
      <RenderPanel
        vsId={vsId}
        story={story}
        shots={shots}
        candidates={tree.candidates}
        renders={tree.renders ?? []}
        onChanged={refresh}
      />
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
          {/* Keyed, so swapping the order moves them without remounting (the draft and check panels keep their polls). The check sits above the shots: it is read before spending; the pictures panel and the every-shot buttons sit between; an empty story offers pictures or a draft. */}
          {shots.length === 0 ? [picturePanel, draftPanel, shotGrid] : [checkPanel, picturePanel, batchPanel, shotGrid, draftPanel]}
        </div>

        <aside ref={asideRef} className="scroll-mt-4 space-y-3">
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
              <Inspector key={editKey ?? 'none'} vsId={vsId} shot={editShot} characters={characters} candidates={candidates} onChanged={refresh} />
            ) : (
              <CharactersPanel vsId={vsId} characters={characters} onChanged={refresh} />
            )}
          </div>
        </aside>
      </div>

      <SpendBar key={story.budgetUsdCap} vsId={vsId} story={story} shots={shots} onChanged={refresh} />
    </div>
  );
}
