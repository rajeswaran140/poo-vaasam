'use client';

/**
 * Reuse a previously-composed brief in the Music Director: load one from a saved
 * .json file (parseBriefFile validates it) or pick one from "My briefs" (the
 * saved-brief library). Either path calls onLoad(lyrics, analysis) to populate
 * the composer so it can be tweaked and re-composed — the "same prompt with
 * minor modifications" workflow.
 */

import { useRef, useState } from 'react';
import { Upload, FolderOpen } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { parseBriefFile } from '@/lib/prompt-export';
import type { ComposerAnalysis } from '@/services/ai/composerSchema';
import type { SavedBrief } from '@/types/brief';

const btnCls =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';

export function BriefReusePanel({
  onLoad,
}: {
  onLoad: (lyrics: string, analysis: ComposerAnalysis) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [briefs, setBriefs] = useState<SavedBrief[]>([]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setError(null);
    try {
      const parsed = parseBriefFile(await file.text());
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      onLoad(parsed.lyrics, parsed.analysis);
    } catch {
      setError('Could not read that file.');
    }
  }

  async function toggleLibrary() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      setBusy(true);
      setError(null);
      try {
        const res = await adminFetch('/api/admin/briefs?limit=50');
        const json = (await res.json()) as { success?: boolean; data?: SavedBrief[]; error?: string };
        if (!res.ok || !json.success) throw new Error(json.error || `Failed to load briefs (${res.status})`);
        setBriefs(json.data ?? []);
        setLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <section
      aria-label="Reuse a saved brief"
      className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/40"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Reuse a brief
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className={btnCls}>
            <Upload className="h-3.5 w-3.5" aria-hidden /> Load from file
          </button>
          <button type="button" onClick={toggleLibrary} aria-expanded={open} className={btnCls}>
            <FolderOpen className="h-3.5 w-3.5" aria-hidden /> My briefs
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onFile}
            className="hidden"
            aria-hidden
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </p>
      )}

      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto">
          {busy ? (
            <p className="px-1 py-2 text-xs text-gray-500 dark:text-gray-400">Loading…</p>
          ) : briefs.length === 0 ? (
            <p className="px-1 py-2 text-xs text-gray-500 dark:text-gray-400">
              No saved briefs yet. Compose one, then “Save brief”.
            </p>
          ) : (
            <ul className="space-y-1">
              {briefs.map((b) => {
                const title = b.analysis?.song_titles?.[0] ?? b.analysis?.theme ?? 'Untitled';
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onLoad(b.lyrics, b.analysis);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-gray-800 hover:bg-white dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <span className="truncate">{title}</span>
                      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-gray-400">
                        {b.createdAt?.slice(0, 10)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
