/**
 * COMPOSITION NOTEBOOK — the per-song record where the language, the lyric and
 * the music decisions converge.
 *
 * Two design rules from the spec, both structural:
 *
 * ⚠️ **PROVENANCE IS PART OF THE DATA (§24).** "Meter: 6/8" and "Suggested
 * meter: 6/8" are different claims, and a notebook that stored only the value
 * would turn a guess into a fact the moment it was saved. Every analytical
 * field can carry a `Provenance`, defaulting to nothing at all rather than to
 * `user-entered` — absence means "not recorded", which is honest, where a
 * default would silently assert authorship.
 *
 * ⚠️ **THE AI PROMPT IS PROVIDER-AGNOSTIC (§17).** The stored field is
 * `aiMusicPrompt`, not `sunoPrompt`. Formatting for a particular service is an
 * EXPORT action, so switching provider — or using three — never means a
 * migration. TamilAgaval must not model its database around one vendor
 * ([[project_tamilagaval_ai_music_rights]]).
 *
 * Versioning mirrors `LyricDraftRepository`: the metadata item holds the
 * working state, and each version is an immutable snapshot in the same
 * partition. Creative decisions are never overwritten (§16).
 */

import { z } from 'zod';

/** Where a value came from. Never collapse these into a boolean. */
export const PROVENANCES = ['user-entered', 'calculated', 'suggested', 'ai-suggested', 'verified'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** How finished the composition is. */
export const COMPOSITION_STATUSES = ['idea', 'sketch', 'arranged', 'recorded', 'released'] as const;
export type CompositionStatus = (typeof COMPOSITION_STATUSES)[number];

/** Song-structure sections (§12), in the order they usually appear. */
export const SONG_SECTIONS = [
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'interlude',
  'bridge',
  'lift',
  'final-chorus',
  'outro',
] as const;
export type SongSection = (typeof SONG_SECTIONS)[number];

export const SECTION_LABELS: Record<SongSection, { english: string; tamil: string }> = {
  intro: { english: 'Intro', tamil: 'தொடக்கம்' },
  verse: { english: 'Verse', tamil: 'சரணம்' },
  'pre-chorus': { english: 'Pre-Chorus', tamil: 'முன்னோட்டம்' },
  chorus: { english: 'Chorus', tamil: 'பல்லவி' },
  interlude: { english: 'Interlude', tamil: 'இடையிசை' },
  bridge: { english: 'Bridge', tamil: 'பாலம்' },
  lift: { english: 'Instrumental Lift', tamil: 'உயர்வு' },
  'final-chorus': { english: 'Final Chorus', tamil: 'இறுதிப் பல்லவி' },
  outro: { english: 'Outro', tamil: 'முடிவு' },
};

/**
 * The musical + creative specification. Every field optional: a notebook starts
 * as a title and an idea, and forcing a tempo before the tune exists would make
 * the tool useless at the moment it is most needed.
 */
export interface CompositionSpec {
  language?: string;
  mood?: string;
  theme?: string;

  bpm?: number;
  meter?: string;
  /** Tonic / சுருதி as a note name — the reference every swara is relative to. */
  tonic?: string;
  scale?: string;
  raga?: string;
  vocalConfiguration?: string;

  melodyNotes?: string;
  rhythmNotes?: string;
  lyricNotes?: string;

  instrumentation?: string;
  arrangementNotes?: string;

  /** Ordered song structure. */
  structure?: SongSection[];
  lyrics?: string;

  /** Provider-agnostic. Formatting for a service is an export, not a field. */
  aiMusicPrompt?: string;

  compositionNotes?: string;
  mixingNotes?: string;
  masteringNotes?: string;

  /**
   * Per-field provenance, keyed by the field name above. A field missing from
   * this map has no recorded provenance — which is NOT the same as being
   * user-entered, and the UI must not render it as though it were.
   */
  sources?: Partial<Record<string, Provenance>>;
}

/** The analytical fields where provenance actually matters. */
export const PROVENANCED_FIELDS = ['bpm', 'meter', 'tonic', 'scale', 'raga'] as const;

export interface CompositionVersion {
  version: number;
  /** Free label — V1, V2, "Final", "the slow one". Defaults to `V<n>`. */
  label: string;
  spec: CompositionSpec;
  /** Why this version exists, in the composer's words. */
  note?: string;
  createdAt: Date;
}

export interface Composition {
  id: string;
  title: string;
  status: CompositionStatus;
  /** The working state — edited freely; a version is a deliberate snapshot. */
  spec: CompositionSpec;
  versions: CompositionVersion[];
  createdAt: Date;
  updatedAt: Date;
}

/** Row for the list view — no version bodies. */
export interface CompositionSummary {
  id: string;
  title: string;
  status: CompositionStatus;
  versionCount: number;
  bpm?: number;
  meter?: string;
  tonic?: string;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const provenanceSchema = z.enum(PROVENANCES);
const shortText = z.string().trim().max(120);
const longText = z.string().trim().max(4000);

export const compositionSpecSchema = z.object({
  language: shortText.optional(),
  mood: shortText.optional(),
  theme: shortText.optional(),
  // 0 is not a tempo; the range matches the metronome's.
  bpm: z.number().int().min(40).max(200).optional(),
  meter: shortText.optional(),
  tonic: shortText.optional(),
  scale: shortText.optional(),
  raga: shortText.optional(),
  vocalConfiguration: shortText.optional(),
  melodyNotes: longText.optional(),
  rhythmNotes: longText.optional(),
  lyricNotes: longText.optional(),
  instrumentation: longText.optional(),
  arrangementNotes: longText.optional(),
  structure: z.array(z.enum(SONG_SECTIONS)).max(24).optional(),
  // A full lyric, same ceiling as a lyric draft version.
  lyrics: z.string().trim().max(8000).optional(),
  aiMusicPrompt: longText.optional(),
  compositionNotes: longText.optional(),
  mixingNotes: longText.optional(),
  masteringNotes: longText.optional(),
  sources: z.record(z.string(), provenanceSchema).optional(),
});

export const createCompositionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(COMPOSITION_STATUSES).default('idea'),
  spec: compositionSpecSchema.default({}),
});
export type CreateCompositionInput = z.infer<typeof createCompositionSchema>;

export const updateCompositionSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    status: z.enum(COMPOSITION_STATUSES),
    spec: compositionSpecSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateCompositionInput = z.infer<typeof updateCompositionSchema>;

export const addCompositionVersionSchema = z.object({
  label: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  /** Snapshot this spec; omitted means "snapshot the current working state". */
  spec: compositionSpecSchema.optional(),
});
export type AddCompositionVersionInput = z.infer<typeof addCompositionVersionSchema>;

// ---------------------------------------------------------------------------
// Comparison + export
// ---------------------------------------------------------------------------

export interface SpecDifference {
  field: string;
  before: string;
  after: string;
}

/** Fields worth diffing between versions — the decisions, not the prose. */
const COMPARED_FIELDS: ReadonlyArray<keyof CompositionSpec> = [
  'bpm',
  'meter',
  'tonic',
  'scale',
  'raga',
  'mood',
  'theme',
  'vocalConfiguration',
  'instrumentation',
  'structure',
];

const show = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '—';
  return Array.isArray(v) ? v.join(' → ') : String(v);
};

/**
 * What changed between two versions. Only the decision fields: diffing every
 * prose note would bury the one thing the composer wants to see, which is
 * whether the tempo or the key moved.
 */
export function compareVersions(a: CompositionSpec, b: CompositionSpec): SpecDifference[] {
  const out: SpecDifference[] = [];
  for (const field of COMPARED_FIELDS) {
    const before = show(a[field]);
    const after = show(b[field]);
    if (before !== after) out.push({ field, before, after });
  }
  return out;
}

/**
 * Format the composition for an external music generator.
 *
 * ⚠️ EXPORT, NOT STORAGE. The prompt lives in `aiMusicPrompt` in a neutral
 * form; this only arranges it for one destination. Adding a second provider
 * means another function here and no change to the data at all.
 *
 * The song's own lyrics are NOT included by default — Raj's lyrics are his
 * legal anchor and are not pasted into third-party services casually
 * ([[project_tamilagaval_ai_music_rights]]).
 */
export function formatForSuno(composition: Pick<Composition, 'title' | 'spec'>): string {
  const s = composition.spec;
  const parts = [
    s.aiMusicPrompt,
    s.mood && `Mood: ${s.mood}`,
    s.bpm && `${s.bpm} BPM`,
    s.meter && `Meter: ${s.meter}`,
    s.tonic && `Key/tonic: ${s.tonic}`,
    s.scale && `Scale: ${s.scale}`,
    s.raga && `Raga: ${s.raga}`,
    s.instrumentation && `Instruments: ${s.instrumentation}`,
    s.vocalConfiguration && `Vocals: ${s.vocalConfiguration}`,
  ].filter(Boolean);
  return parts.join('. ');
}

/** Default label for version n. */
export function defaultVersionLabel(n: number): string {
  return `V${n}`;
}
