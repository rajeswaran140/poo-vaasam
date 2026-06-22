/**
 * Saved production brief — the durable, model-agnostic source of truth for a
 * song (Phase 2 of the Music Director). The structured `analysis` is the
 * intent; the engine prompts inside it (suno_prompts) are derived renderings.
 * `decision` + `outcome` are the signals that turn the catalogue into a
 * knowledge base over time; `embedding` is reserved for future similarity
 * search (not populated yet — captured early, modelled later).
 */

import type { ComposerAnalysis } from '@/services/ai/composer';

/** What the admin chose/edited when saving — the human decision signal. */
export interface BriefDecision {
  /** Style label of the the generator variant the admin picked, if any. */
  chosenSunoStyle?: string;
  /** Free-text note (e.g. a manual tweak the admin made). */
  notes?: string;
}

/** Performance signal, filled later from YouTube analytics (Pillar 3). */
export interface BriefOutcome {
  youtubeVideoId?: string;
  views?: number;
  /** Average view duration / retention %, when known. */
  retention?: number;
  subscribersGained?: number;
}

export interface SavedBrief {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The lyrics that produced the brief — kept so it can be re-rendered. */
  lyrics: string;
  /** Structured intent + renderings (emotion/key/instruments/suno_prompts/…). */
  analysis: ComposerAnalysis;
  /** Provenance: which generation model produced this brief. */
  model: string;
  /** Link to a /content song, if the brief was attached to one. */
  contentId?: string;
  decision: BriefDecision;
  /** Populated later from analytics; null until known. */
  outcome: BriefOutcome | null;
  /** Reserved for future similarity search (DynamoDB cosine, then a vector DB at scale). */
  embedding: number[] | null;
}

/** Payload accepted by POST /api/admin/briefs. */
export interface CreateBriefDTO {
  lyrics: string;
  analysis: ComposerAnalysis;
  contentId?: string;
  decision?: BriefDecision;
}
