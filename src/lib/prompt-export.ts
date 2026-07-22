/**
 * Build a generator-ready "pack" from a composed brief variant and export it as
 * Markdown. The pack is organised by the generator's custom-mode fields so each block
 * copy-pastes straight into the matching box: Lyrics, Style of Music, Exclude
 * Styles, Weirdness %, Style Influence %. Exclusions/weirdness/influence are
 * RECOMMENDATIONS derived from the brief (clearly labelled — adjust to taste).
 * Pure + dependency-free → unit-testable; PDF is print-rendered by the client.
 *
 * This module also handles the FULL-brief file forms used to save a composed
 * prompt for later reuse: a human-readable Markdown export of every section, and
 * a re-loadable JSON file (serialize + validated parse). composerSchema is
 * bundle-safe (no server SDKs), so validating on load stays client-side.
 */

import { composerAnalysisSchema, type ComposerAnalysis } from '@/services/ai/composerSchema';

export interface ExportPackInput {
  title: string;
  lyrics: string;
  /** The chosen variant's short style name + full style prompt. */
  styleName: string;
  stylePrompt: string;
  /** Optional brief context that tunes the recommendations. */
  mood?: string;
  theme?: string;
  /**
   * Structured musical direction from the brief. The variant paragraph is ASKED
   * to mention tempo/instrumentation, but it's prose from a model — it drifts,
   * and `recommended_voice` was never in its remit at all. Passing these lets us
   * append a deterministic anchor line so the exact values always reach the
   * generator's style box. See buildStyleAnchor.
   */
  bpm?: number;
  key?: string;
  instruments?: string[];
  ragas?: string[];
  voice?: string[];
}

export interface ExportPack {
  title: string;
  lyrics: string;
  styleName: string;
  style: string;
  excludeStyles: string;
  weirdnessPct: number;
  styleInfluencePct: number;
}

// Styles to exclude by default for the channel's melodic/acoustic Tamil songs —
// each dropped if the chosen style actually asks for it.
const DEFAULT_EXCLUSIONS = [
  'heavy autotune',
  'EDM',
  'trap beats',
  'rap',
  'heavy metal',
  'screaming vocals',
  'distorted electric guitar',
  'dubstep',
];

const EXPERIMENTAL = /\b(experimental|fusion|modern|electronic|psychedelic|avant-?garde|glitch)\b/i;
const TRADITIONAL = /\b(traditional|classical|carnatic|devotional|folk|bhajan|lament|temple)\b/i;

/** Derive a recommended exclusion list: defaults minus anything the style wants. */
export function deriveExclusions(stylePrompt: string): string {
  const s = stylePrompt.toLowerCase();
  return DEFAULT_EXCLUSIONS.filter((x) => !s.includes(x.toLowerCase().split(' ')[0])).join(', ');
}

/** Recommended weirdness %: low for traditional, higher for experimental. */
export function deriveWeirdness(stylePrompt: string, mood = ''): number {
  const hay = `${stylePrompt} ${mood}`;
  if (EXPERIMENTAL.test(hay)) return 35;
  if (TRADITIONAL.test(hay)) return 15;
  return 20;
}

/**
 * A compact, explicit restatement of the brief's structured direction, appended
 * to the style prompt.
 *
 * Why this exists: generators anchor far better on named genre, BPM,
 * instrumentation and VOCAL CHARACTER than on a prose paragraph — which is also
 * what Suno support advised when prompt adherence regressed (2026-07). The
 * variant paragraph is model prose and drifts; worse, the brief's
 * `recommended_voice` never reached the style box at all, so the one field
 * describing the singer was being computed and then dropped.
 *
 * Deliberately deterministic string-building — no model in this path — so the
 * exported pack is reproducible and unit-testable. Empty sections are omitted
 * rather than emitted blank, and a brief with no structured fields yields '',
 * leaving the prompt exactly as it was.
 */
export function buildStyleAnchor(input: ExportPackInput): string {
  const parts: string[] = [];
  const list = (xs?: string[]) => (xs ?? []).map((x) => (x ?? '').trim()).filter(Boolean);

  if (Number.isFinite(input.bpm as number)) parts.push(`${input.bpm} BPM`);
  const key = (input.key ?? '').trim();
  if (key) parts.push(`key ${key}`);

  const ragas = list(input.ragas);
  if (ragas.length) parts.push(`raga ${ragas[0]}`);

  const instruments = list(input.instruments);
  if (instruments.length) parts.push(`lead instruments ${instruments.join(', ')}`);

  const voice = list(input.voice);
  if (voice.length) parts.push(`vocal ${voice[0]}`);

  return parts.length ? `${parts.join('. ')}.` : '';
}

export function buildExportPack(input: ExportPackInput): ExportPack {
  const stylePrompt = (input.stylePrompt ?? '').trim();
  const anchor = buildStyleAnchor(input);
  return {
    title: (input.title ?? '').trim() || 'Untitled',
    lyrics: (input.lyrics ?? '').trim(),
    styleName: (input.styleName ?? '').trim(),
    style: [stylePrompt, anchor].filter(Boolean).join(' '),
    excludeStyles: deriveExclusions(stylePrompt),
    weirdnessPct: deriveWeirdness(stylePrompt, input.mood),
    // Moderate-high: follow the described instrumentation/raga fairly closely.
    styleInfluencePct: 50,
  };
}

/** Render a export pack as copy-paste Markdown, one section per generator field. */
export function exportPackToMarkdown(pack: ExportPack): string {
  return [
    `# ${pack.title}`,
    '',
    `_Tamilagaval pack — style: ${pack.styleName || '—'}. Copy each block into the matching field._`,
    '',
    '## 🎤 Lyrics',
    '',
    pack.lyrics || '_(none)_',
    '',
    '## 🎚️ Style of Music',
    '',
    pack.style || '_(none)_',
    '',
    '## 🚫 Exclude Styles',
    '',
    pack.excludeStyles || '_(none)_',
    '',
    '## 🎛️ Weirdness',
    '',
    `${pack.weirdnessPct}%  _(recommended — adjust to taste)_`,
    '',
    '## 🌟 Style Influence',
    '',
    `${pack.styleInfluencePct}%  _(recommended — adjust to taste)_`,
    '',
    '---',
    '_Generated by Tamilagaval composer. Exclusions/weirdness/influence are starting points, not rules._',
    '',
  ].join('\n');
}

/**
 * Render the ENTIRE composed brief (every section, all style variants) as one
 * human-readable Markdown file — for saving a prompt to reuse & tweak on the
 * next song. Unlike exportPackToMarkdown (one generator variant), this captures
 * the whole brief.
 */
export function analysisToFullMarkdown(analysis: ComposerAnalysis, lyrics: string): string {
  const title = analysis.song_titles?.[0] ?? 'Untitled';
  const lines: string[] = [
    `# ${title}`,
    '',
    '_Tamilagaval full brief — every section of the composed prompt, saved for reuse & tweaking._',
    '',
    '## 🎤 Lyrics',
    '',
    (lyrics ?? '').trim() || '_(none)_',
    '',
    '## 🎭 Emotion',
    '',
    `Dominant: **${analysis.emotion}**`,
    '',
    `Ranked: ${analysis.emotion_breakdown.join(' › ')}`,
    '',
    '## 🎚️ Musical direction',
    '',
    `- **Mood:** ${analysis.mood}`,
    `- **Theme:** ${analysis.theme}`,
    `- **Key:** ${analysis.suggested_key}`,
    `- **BPM:** ${analysis.suggested_bpm}`,
    `- **Instruments:** ${analysis.suggested_instruments.join(', ')}`,
    `- **Ragas:** ${analysis.suggested_ragas.join(', ')}`,
    `- **Voice:** ${analysis.recommended_voice.join(', ')}`,
    '',
    '## 🏷️ Song titles',
    '',
    ...analysis.song_titles.map((t) => `- ${t}`),
    '',
    '## 🎵 Style prompts',
    '',
  ];
  analysis.suno_prompts.forEach((v, i) => {
    lines.push(`### ${i + 1}. ${v.style}`, '', v.prompt, '');
  });
  lines.push(
    '## 🖼️ Thumbnail prompt',
    '',
    analysis.thumbnail_prompt,
    '',
    '## 📺 YouTube description — Tamil',
    '',
    analysis.youtube_description_tamil,
    '',
    '## 📺 YouTube description — English',
    '',
    analysis.youtube_description_english,
    '',
    '## 🎬 Reel / Short',
    '',
    `- **Hook:** ${analysis.reel.hook || '—'}`,
    `- **Caption:** ${analysis.reel.caption || '—'}`,
    `- **Hashtags:** ${analysis.reel.hashtags.join(' ') || '—'}`,
    '',
    '---',
    '_Generated by the Tamilagaval Music Director._',
    ''
  );
  return lines.join('\n');
}

export const BRIEF_FILE_FORMAT = 'tamilagaval-brief';
export const BRIEF_FILE_VERSION = 1;

export interface BriefFile {
  format: typeof BRIEF_FILE_FORMAT;
  version: number;
  savedAt?: string;
  lyrics: string;
  analysis: ComposerAnalysis;
}

/** Serialize a composed brief to a re-loadable JSON string (round-trips via parseBriefFile). */
export function serializeBriefFile(lyrics: string, analysis: ComposerAnalysis, savedAt?: string): string {
  const file: BriefFile = {
    format: BRIEF_FILE_FORMAT,
    version: BRIEF_FILE_VERSION,
    ...(savedAt ? { savedAt } : {}),
    lyrics,
    analysis,
  };
  return JSON.stringify(file, null, 2);
}

export type ParsedBriefFile =
  | { ok: true; lyrics: string; analysis: ComposerAnalysis }
  | { ok: false; error: string };

/**
 * Parse + validate a brief file loaded from disk. Rejects anything that isn't a
 * well-formed Tamilagaval brief so a malformed/foreign file can never load a
 * broken analysis into the composer.
 */
export function parseBriefFile(text: string): ParsedBriefFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t valid JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Unrecognised file.' };
  const obj = raw as Record<string, unknown>;
  if (obj.format !== BRIEF_FILE_FORMAT) {
    return { ok: false, error: 'Not a Tamilagaval brief file.' };
  }
  const lyrics = typeof obj.lyrics === 'string' ? obj.lyrics : '';
  const parsed = composerAnalysisSchema.safeParse(obj.analysis);
  if (!parsed.success) {
    return { ok: false, error: 'The brief data is invalid or from an incompatible version.' };
  }
  return { ok: true, lyrics, analysis: parsed.data };
}

/** A safe, lowercase, dash-joined filename stem from a (possibly Tamil) title. */
export function exportFilename(title: string, ext: string): string {
  const ascii = (title || 'suno-pack')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${ascii || 'suno-pack'}.${ext}`;
}
