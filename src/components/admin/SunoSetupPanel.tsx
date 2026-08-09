'use client';

/**
 * Build SUNO setup — the arrangement step, beside the export pack.
 *
 * The pack already assembles style / exclude / weirdness / influence. The one
 * field it cannot derive is the LYRICS box: a lyric needs breaking at musical
 * points with [Kind - Detail] tags, and roughly half of those name instrumental
 * breaks. That is a model call, so it sits behind an explicit button rather
 * than firing on every brief — it costs money and only matters once a style has
 * been chosen.
 *
 * The generated block is handed UPWARD, not rendered as a dead artefact: the
 * parent feeds it back into buildExportPack so the pack the writer copies is
 * the arranged one. A panel that showed the arrangement but left the pack
 * un-arranged would be worse than none, because it would look done.
 */

import { useState } from 'react';
import { Copy, Check, Wand2 } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';
import { PROMPT_LIMITS } from '@/lib/prompt-preflight';
import { STYLE_TARGET_MIN, STYLE_TARGET_MAX, type SetupFinding } from '@/lib/suno-setup';

interface GeneratedSetup {
  lyrics_block: string;
  style: string;
  weirdness: number;
  style_influence: number;
  exclude: string[];
  slider_rationale: string;
}

interface Props {
  lyrics: string;
  styleName: string;
  stylePrompt: string;
  instruments?: string[];
  ragas?: string[];
  voices?: string[];
  bpm?: number;
  musicKey?: string;
  mood?: string;
  /** Handed the arranged block so the export pack uses it. */
  onArranged: (block: string, exclude: string[]) => void;
}

function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </span>
        <div className="flex items-center gap-2">
          {hint && <span className="text-xs text-gray-400 dark:text-gray-500">{hint}</span>}
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked — the text is still selectable */
              }
            }}
            aria-label={`Copy ${label}`}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-300"
          >
            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 p-2 font-tamil text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
        {value || '—'}
      </pre>
    </div>
  );
}

export function SunoSetupPanel({
  lyrics,
  styleName,
  stylePrompt,
  instruments = [],
  ragas = [],
  voices = [],
  bpm,
  musicKey,
  mood,
  onArranged,
}: Props) {
  const [setup, setSetup] = useState<GeneratedSetup | null>(null);
  const [findings, setFindings] = useState<SetupFinding[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch('/api/admin/compose/suno-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lyrics,
          style: styleName,
          styleBrief: stylePrompt,
          instruments,
          ragas,
          voices,
          ...(bpm ? { bpm } : {}),
          ...(musicKey ? { key: musicKey } : {}),
          ...(mood ? { mood } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        setup?: GeneratedSetup;
        findings?: SetupFinding[];
        ready?: boolean;
        error?: string;
      };
      if (!res.ok || !json.success || !json.setup) throw new Error(json.error || `Failed (${res.status})`);
      setSetup(json.setup);
      setFindings(json.findings ?? []);
      setReady(json.ready !== false);
      onArranged(json.setup.lyrics_block, json.setup.exclude);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const styleLen = setup?.style.length ?? 0;
  const inBand = styleLen >= STYLE_TARGET_MIN && styleLen <= STYLE_TARGET_MAX;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">SUNO setup</h4>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Breaks the lyric at musical points and fills all four boxes. Your Tamil lines are reproduced
            exactly.
          </p>
        </div>
        <button
          type="button"
          onClick={build}
          disabled={loading || !lyrics.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Wand2 className="h-4 w-4" aria-hidden="true" />
          {loading ? 'Building…' : setup ? 'Rebuild' : 'Build SUNO setup'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">⚠️ {error}</p>}

      {setup && (
        <div className="mt-4 space-y-4">
          {findings.length > 0 && (
            <ul
              className={`space-y-1 rounded-lg border p-3 text-sm ${
                ready
                  ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200'
                  : 'border-red-300 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200'
              }`}
              data-testid="setup-findings"
            >
              {findings.map((f, i) => (
                <li key={i}>
                  <strong>{f.field}:</strong> {f.message}
                  {f.fix && <span className="block text-xs opacity-80">{f.fix}</span>}
                </li>
              ))}
            </ul>
          )}

          <CopyField label="Lyrics box" value={setup.lyrics_block} />
          <CopyField
            label="Style box"
            value={setup.style}
            hint={`${styleLen} / ${PROMPT_LIMITS.STYLE_MAX}${inBand ? '' : ' — outside the useful band'}`}
          />
          <CopyField label="Exclude" value={setup.exclude.join(', ')} />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <span className="block text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Weirdness
              </span>
              <span className="text-lg text-gray-900 dark:text-gray-100">{setup.weirdness}%</span>
            </div>
            <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
              <span className="block text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Style influence
              </span>
              <span className="text-lg text-gray-900 dark:text-gray-100">{setup.style_influence}%</span>
            </div>
          </div>
          {setup.slider_rationale && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{setup.slider_rationale}</p>
          )}
        </div>
      )}
    </section>
  );
}
