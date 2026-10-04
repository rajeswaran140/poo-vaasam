'use client';

/**
 * The live mixer — a fader, Mute and Solo per stem, played back with Web
 * Audio against the listening copies so the operator hears every change
 * instantly, with levels auto-saved to the stem set's `#mix`.
 *
 * Solo is a LISTENING AID ONLY: local state, never part of the saved mix,
 * never sent to the server. Muting a different stem to audition one is a
 * real edit; soloing is just how you listen while deciding.
 *
 * A stem without a listening copy yet (no `previewKey`) gets no fader — the
 * operator can't preview a level change with nothing to play — but it keeps
 * its Mute button and level readout, so it can still be left out of a
 * render, and every other stem's mixer keeps working.
 *
 * Saves are serialised (each PUT waits for the one before it) and exposed
 * through `ref.flush()`, so the page can make sure the levels the operator
 * last set are on the server before it asks for a render.
 */

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Pause, Play } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { formatClock } from '@/components/admin/ShortWindowFields';
import { MIN_GAIN_DB, MAX_GAIN_DB } from '@/lib/stems';
import { useStemMixer } from '@/components/admin/stems/useStemMixer';
import type { StemMixEntry, StemSet } from '@/types/stemSet';

/** Debounce window before a fader/mute/reset change is written to the server. */
const MIX_SAVE_DELAY_MS = 400;

const NEUTRAL_LEVEL: StemMixEntry = { gainDb: 0, muted: false };

function initialMix(set: StemSet): Record<string, StemMixEntry> {
  const out: Record<string, StemMixEntry> = {};
  for (const id of set.order) out[id] = set.mix[id] ?? NEUTRAL_LEVEL;
  return out;
}

/** "0.0 dB", "+2.5 dB", "−6.0 dB", or "−∞" at MIN_GAIN_DB. */
function formatGainDb(gainDb: number): string {
  if (gainDb <= MIN_GAIN_DB) return '−∞';
  if (gainDb > 0) return `+${gainDb.toFixed(1)} dB`;
  if (gainDb < 0) return `−${Math.abs(gainDb).toFixed(1)} dB`;
  return '0.0 dB';
}

export interface StemMixerHandle {
  /**
   * Send any change still waiting out the autosave delay now, and wait for
   * every save already sent. Resolves true only if the latest levels are
   * saved; false if that save failed (the mixer shows why).
   */
  flush: () => Promise<boolean>;
}

interface Props {
  set: StemSet;
  masterJobId: string;
  /** Fired with the full mix right after it's successfully saved. */
  onMixChange?: (mix: Record<string, StemMixEntry>) => void;
  /** Fired whenever the last save's error appears or clears (null = saved). */
  onSaveErrorChange?: (error: string | null) => void;
  ref?: Ref<StemMixerHandle>;
}

export function StemMixer({ set, masterJobId, onMixChange, onSaveErrorChange, ref }: Props) {
  const [mix, setMix] = useState<Record<string, StemMixEntry>>(() => initialMix(set));
  const [solo, setSolo] = useState<ReadonlySet<string>>(() => new Set());
  const [playUrls, setPlayUrls] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const mixRef = useRef(mix);
  useEffect(() => {
    mixRef.current = mix;
  }, [mix]);

  const mountedRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // A stem that joins the set after mount (a new upload) gets a default
  // entry here. Existing ids are never overwritten — the server's `set`
  // prop reloads every 4s while the operator may be mid-drag on a fader.
  useEffect(() => {
    setMix((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of set.order) {
        if (!(id in next)) {
          next[id] = set.mix[id] ?? NEUTRAL_LEVEL;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [set.order, set.mix]);

  const mixer = useStemMixer({
    stems: useMemo(
      () => set.order.filter((id) => playUrls[id]).map((id) => ({ id, url: playUrls[id] })),
      [set.order, playUrls]
    ),
    gains: mix,
    solo,
  });

  // Resolve each stem's listening-copy URL once — only if this browser can
  // actually play it back; otherwise there's nothing to fetch for.
  const resolvingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!mixer.supported) return;
    for (const id of set.order) {
      const previewKey = set.stems[id]?.previewKey;
      if (!previewKey) continue;
      if (playUrls[id] || resolvingRef.current.has(id)) continue;
      resolvingRef.current.add(id);
      void (async () => {
        try {
          const res = await adminFetch(`/api/admin/mastering/download?key=${encodeURIComponent(previewKey)}&mode=play`);
          const body = await res.json();
          if (res.ok && body.success && mountedRef.current) {
            setPlayUrls((prev) => ({ ...prev, [id]: body.url }));
          }
        } catch {
          // The row keeps showing "waiting for its listening copy" and the
          // rest of the mixer carries on.
        } finally {
          resolvingRef.current.delete(id);
        }
      })();
    }
  }, [mixer.supported, set.order, set.stems, playUrls]);

  useEffect(() => {
    onSaveErrorChange?.(saveError);
  }, [saveError, onSaveErrorChange]);

  // The most recent save's outcome. Each save chains onto the one before it,
  // so PUTs reach the server in the order the operator made the changes and
  // awaiting this one promise means every earlier save has settled too.
  const lastSaveRef = useRef<Promise<boolean>>(Promise.resolve(true));

  const saveNow = useCallback(
    (next: Record<string, StemMixEntry>): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        try {
          const res = await adminFetch(`/api/admin/stems/${masterJobId}/mix`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mix: next }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || body.success === false) throw new Error(body.error || 'Could not save the mix.');
          if (mountedRef.current) {
            setSaveError(null);
            onMixChange?.(next);
          }
          return true;
        } catch (err) {
          if (mountedRef.current) setSaveError(err instanceof Error ? err.message : String(err));
          return false;
        }
      };
      const saved = lastSaveRef.current.then(run);
      lastSaveRef.current = saved;
      return saved;
    },
    [masterJobId, onMixChange]
  );

  const scheduleSave = useCallback(
    (next: Record<string, StemMixEntry>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveNow(next);
      }, MIX_SAVE_DELAY_MS);
    },
    [saveNow]
  );

  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
          return saveNow(mixRef.current);
        }
        return lastSaveRef.current;
      },
    }),
    [saveNow]
  );

  const commit = useCallback(
    (next: Record<string, StemMixEntry>) => {
      mixRef.current = next;
      setMix(next);
      scheduleSave(next);
    },
    [scheduleSave]
  );

  const setGainDb = useCallback(
    (id: string, gainDb: number) => {
      const current = mixRef.current[id] ?? NEUTRAL_LEVEL;
      commit({ ...mixRef.current, [id]: { ...current, gainDb } });
    },
    [commit]
  );

  const toggleMute = useCallback(
    (id: string) => {
      const current = mixRef.current[id] ?? NEUTRAL_LEVEL;
      commit({ ...mixRef.current, [id]: { ...current, muted: !current.muted } });
    },
    [commit]
  );

  const toggleSolo = useCallback((id: string) => {
    setSolo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next: Record<string, StemMixEntry> = {};
    for (const id of set.order) next[id] = { ...NEUTRAL_LEVEL };
    setSolo(new Set());
    commit(next);
  }, [set.order, commit]);

  return (
    <section
      aria-label="Mixer"
      className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-800"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Mixer</h2>
        <button
          type="button"
          onClick={reset}
          className="text-xs font-medium text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
        >
          Reset
        </button>
      </div>

      {mixer.supported ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            aria-label={mixer.playing ? 'Pause' : 'Play'}
            disabled={!mixer.ready && !mixer.playing}
            onClick={() => (mixer.playing ? mixer.pause() : mixer.play())}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white transition hover:bg-orange-700 disabled:opacity-40"
          >
            {mixer.playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          </button>
          <input
            type="range"
            aria-label="Playback position"
            min={0}
            max={mixer.duration || 0}
            step={0.1}
            value={mixer.position}
            disabled={!mixer.ready && !mixer.playing}
            onChange={(e) => mixer.seek(Number(e.target.value))}
            className="min-w-[8rem] grow"
          />
          <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {formatClock(Math.round(mixer.position))} / {formatClock(Math.round(mixer.duration))}
          </span>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">This browser cannot play the mix.</p>
      )}

      <div className="space-y-3">
        {set.order.map((id) => {
          const stemEntry = set.stems[id];
          if (!stemEntry) return null;
          const level = mix[id] ?? NEUTRAL_LEVEL;
          const silent = level.muted || level.gainDb <= MIN_GAIN_DB;
          const muteButton = (
            <button
              type="button"
              aria-label={`Mute ${stemEntry.name}`}
              aria-pressed={level.muted}
              onClick={() => toggleMute(id)}
              className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                level.muted
                  ? 'border-red-400 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              Mute
            </button>
          );
          const readout = (
            <span
              data-testid={`level-${id}`}
              className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400"
            >
              {formatGainDb(level.gainDb)}
            </span>
          );
          if (!stemEntry.previewKey) {
            // Nothing to play yet, so no fader and no Solo — but it can
            // still be muted out of the render.
            return (
              <div key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="min-w-[8rem] grow text-xs text-gray-400">
                  {stemEntry.name} is waiting for its listening copy.
                </p>
                {readout}
                {muteButton}
              </div>
            );
          }
          return (
            <div key={id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className={`w-28 shrink-0 truncate text-sm ${
                  silent ? 'text-gray-400' : 'text-gray-800 dark:text-gray-100'
                }`}
              >
                {stemEntry.name}
              </span>
              <input
                type="range"
                min={MIN_GAIN_DB}
                max={MAX_GAIN_DB}
                step={0.5}
                value={level.gainDb}
                aria-label={`${stemEntry.name} level`}
                onChange={(e) => setGainDb(id, Number(e.target.value))}
                className="min-w-[8rem] grow"
              />
              {readout}
              {muteButton}
              <button
                type="button"
                aria-label={`Solo ${stemEntry.name}`}
                aria-pressed={solo.has(id)}
                onClick={() => toggleSolo(id)}
                className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
                  solo.has(id)
                    ? 'border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-600 dark:bg-orange-950/40 dark:text-orange-300'
                    : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                Solo
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        A mix of the stems is a new version — it will not sound exactly like the original release.
      </p>

      {saveError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {saveError}
        </p>
      )}
    </section>
  );
}
