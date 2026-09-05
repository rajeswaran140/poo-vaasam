'use client';

/**
 * SUNO PROMPT STUDIO — build a prompt pack from a lyric and keep it.
 *
 * The compose flow already produces this pack (SunoSetupPanel), but only inside
 * a job result that is handed to the export pack and then lost. This is the
 * standalone home: paste a lyric, generate, save, reopen later.
 *
 * It calls the SAME generator — POST /api/admin/compose/suno-setup, then poll —
 * rather than reimplementing it. The work runs on the 180s worker Lambda
 * because Amplify's SSR compute caps at ~30s.
 *
 * ⚠️ AUDIO INFLUENCE IS NOT A THIRD SLIDER. Suno shows that control only when
 * an audio file is uploaded (help.suno.com/en/articles/6141377); Weirdness and
 * Style Influence are always present in Custom mode. So it lives behind a
 * per-prompt toggle, and the reason is printed on screen — a control that is
 * silently absent looks like a missing feature.
 *
 * The generated fields are copy-and-paste artefacts, not editable text: the
 * model wrote them to hang together. The three percentages ARE editable,
 * because they are settings the writer chooses per generation.
 */

import { useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { pollJob } from '@/lib/poll-job';
import { WEIRDNESS_DEFAULT, STYLE_INFLUENCE_DEFAULT, SLIDER_MIN, SLIDER_MAX } from '@/lib/suno-setup';

/** Matches SunoSetupPanel's cadence; the worker's ceiling is 180s. */
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 170_000;

export interface SunoPromptRow {
  id: string;
  title: string;
  lyrics: string;
  style: string;
  styleBox: string;
  exclude: string[];
  lyricsBlock: string;
  weirdness: number;
  styleInfluence: number;
  usesAudioUpload: boolean;
  audioInfluence?: number;
}

interface GeneratedSetup {
  lyrics_block: string;
  style: string;
  weirdness: number;
  style_influence: number;
  exclude: string[];
}

interface Props {
  initial: SunoPromptRow[];
  /** Preload the editor with an existing pack (used when reopening one). */
  loaded?: SunoPromptRow;
}

function CopyBlock({ title, value }: { title: string; value: string }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{title}</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(value)}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Copy
        </button>
      </div>
      <textarea
        readOnly
        aria-label={`Suno ${title}`}
        value={value}
        rows={title === 'lyrics box' ? 8 : 3}
        className="w-full rounded-md border border-gray-300 bg-gray-50 p-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-900"
      />
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
        <span>{label}</span>
        <span className="font-medium text-gray-900 dark:text-gray-100">{value}%</span>
      </label>
      <input
        id={id}
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

export function SunoPromptStudio({ initial, loaded }: Props) {
  const [saved, setSaved] = useState<SunoPromptRow[]>(initial);
  const [title, setTitle] = useState(loaded?.title ?? '');
  const [lyrics, setLyrics] = useState(loaded?.lyrics ?? '');
  const [style, setStyle] = useState(loaded?.style ?? '');
  const [styleBox, setStyleBox] = useState(loaded?.styleBox ?? '');
  const [exclude, setExclude] = useState<string[]>(loaded?.exclude ?? []);
  const [lyricsBlock, setLyricsBlock] = useState(loaded?.lyricsBlock ?? '');
  const [weirdness, setWeirdness] = useState(loaded?.weirdness ?? WEIRDNESS_DEFAULT);
  const [styleInfluence, setStyleInfluence] = useState(loaded?.styleInfluence ?? STYLE_INFLUENCE_DEFAULT);
  const [usesAudioUpload, setUsesAudioUpload] = useState(loaded?.usesAudioUpload ?? false);
  const [audioInfluence, setAudioInfluence] = useState(loaded?.audioInfluence ?? 50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPack = Boolean(styleBox || lyricsBlock);
  const canGenerate = lyrics.trim().length > 0 && style.trim().length > 0 && !busy;
  const canSave = hasPack && title.trim().length > 0 && !busy;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/compose/suno-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lyrics, style, instruments: [], ragas: [], voices: [] }),
      });
      const body = await res.json();
      if (!res.ok || !body.jobId) throw new Error(body.error || `HTTP ${res.status}`);

      const controller = new AbortController();
      const result = await pollJob<{ setup: GeneratedSetup }>({
        fetchStatus: (signal) =>
          adminFetch(`/api/admin/compose/suno-setup/${body.jobId}`, { signal }),
        intervalMs: POLL_INTERVAL_MS,
        timeoutMs: POLL_TIMEOUT_MS,
        signal: controller.signal,
        isMounted: () => true,
        timeoutMessage: 'Generating the pack took too long — try again.',
      });
      if (result?.setup) {
        setStyleBox(result.setup.style);
        setExclude(result.setup.exclude ?? []);
        setLyricsBlock(result.setup.lyrics_block);
        setWeirdness(result.setup.weirdness);
        setStyleInfluence(result.setup.style_influence);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/suno-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          lyrics,
          style,
          styleBox,
          exclude,
          lyricsBlock,
          weirdness,
          styleInfluence,
          usesAudioUpload,
          // Omitted entirely when unused — the API rejects it otherwise.
          ...(usesAudioUpload ? { audioInfluence } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.prompt) throw new Error(body.error || `HTTP ${res.status}`);
      setSaved((prev) => [body.prompt as SunoPromptRow, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <section className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="sp-title" className="text-xs font-medium text-gray-700 dark:text-gray-200">
            Prompt title
          </label>
          <input
            id="sp-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enna Idhu Kadhalā — folk take"
            className="w-full rounded-md border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sp-lyrics" className="text-xs font-medium text-gray-700 dark:text-gray-200">
            Lyrics
          </label>
          <textarea
            id="sp-lyrics"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={10}
            placeholder="பாடல் வரிகள்…"
            className="w-full rounded-md border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="sp-style" className="text-xs font-medium text-gray-700 dark:text-gray-200">
            Style name
          </label>
          <input
            id="sp-style"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="Tamil village folk"
            className="w-full rounded-md border border-gray-300 p-2 text-sm dark:border-gray-600 dark:bg-gray-900"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={generate}
            disabled={!canGenerate}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900"
          >
            {busy ? 'Working…' : 'Generate pack'}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
          >
            Save prompt
          </button>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <CopyBlock title="style box" value={styleBox} />
        <CopyBlock title="exclude" value={exclude.join(', ')} />
        <CopyBlock title="lyrics box" value={lyricsBlock} />

        <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <Slider id="sp-weirdness" label="Weirdness %" value={weirdness} onChange={setWeirdness} />
          <Slider
            id="sp-style-influence"
            label="Style Influence %"
            value={styleInfluence}
            onChange={setStyleInfluence}
          />

          <div className="flex items-center gap-2 pt-1">
            <input
              id="sp-audio-upload"
              type="checkbox"
              checked={usesAudioUpload}
              onChange={(e) => setUsesAudioUpload(e.target.checked)}
            />
            <label htmlFor="sp-audio-upload" className="text-xs text-gray-700 dark:text-gray-200">
              This prompt uses an audio upload
            </label>
          </div>
          <p className="text-xs text-gray-500">
            Suno only offers the Audio Influence slider when you use an audio upload, so it stays
            hidden until you tick that.
          </p>
          {usesAudioUpload && (
            <Slider
              id="sp-audio-influence"
              label="Audio Influence %"
              value={audioInfluence}
              onChange={setAudioInfluence}
            />
          )}
        </div>
      </section>

      <aside className="space-y-2">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">Saved prompts</h2>
        {saved.length === 0 ? (
          <p className="text-xs text-gray-500">No saved prompts yet.</p>
        ) : (
          <ul className="space-y-1">
            {saved.map((p) => (
              <li
                key={p.id}
                className="rounded-md border border-gray-200 p-2 text-xs dark:border-gray-700"
              >
                <div className="font-medium text-gray-900 dark:text-gray-100">{p.title}</div>
                <div className="text-gray-500">{p.style}</div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
