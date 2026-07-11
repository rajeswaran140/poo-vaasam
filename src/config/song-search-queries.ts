/**
 * Per-song search-query test sets — the queries we track a song's search
 * position against (a discovery test set, NOT keywords to stuff into the
 * title/description). Each query carries its intent bucket and how strongly a
 * searcher on it is likely to convert for THIS song, which feed the
 * Opportunity Score (see lib/opportunity-score).
 *
 * Positions for these queries are HUMAN-OBSERVED (logged into the observation
 * store), never taken from the unpersonalized search.list API — which disagrees
 * with the personalized app rank (see project_poo_vaasam_seo_funnel).
 */

export type QueryIntent = 'english_diaspora' | 'father_loss' | 'tamil_search' | 'grief' | 'discovery';
export type ConversionPotential = 'high' | 'medium' | 'low';

export interface TrackedQuery {
  query: string;
  intent: QueryIntent;
  /** How likely a searcher on this query converts for this specific song. */
  conversion: ConversionPotential;
}

export interface SongQuerySet {
  videoId: string;
  label: string;
  queries: TrackedQuery[];
}

/**
 * "அன்பை சுமந்து சுமந்து / Anbai Sumanthu Sumanthu" (kOpNZHlE9FE) — Raj's father
 * song. The five HIGH-conversion queries are the ones he flagged as most likely
 * to bring a searcher who wants exactly this song.
 */
const ANBAI_SUMANTHU: SongQuerySet = {
  videoId: 'kOpNZHlE9FE',
  label: 'அன்பை சுமந்து சுமந்து · Anbai Sumanthu Sumanthu',
  queries: [
    { query: 'tamil father grief song', intent: 'english_diaspora', conversion: 'high' },
    { query: 'tamil father loss song', intent: 'english_diaspora', conversion: 'high' },
    { query: 'emotional tamil father song', intent: 'english_diaspora', conversion: 'medium' },
    { query: 'tamil song about losing father', intent: 'english_diaspora', conversion: 'medium' },
    { query: 'missing dad song tamil', intent: 'english_diaspora', conversion: 'medium' },
    { query: 'father memorial song tamil', intent: 'father_loss', conversion: 'medium' },
    { query: 'missing father tamil song', intent: 'father_loss', conversion: 'high' },
    { query: 'sad tamil song for father', intent: 'father_loss', conversion: 'medium' },
    { query: 'appa emotional song tamil', intent: 'father_loss', conversion: 'medium' },
    { query: 'appa remembrance song', intent: 'father_loss', conversion: 'medium' },
    { query: 'அப்பா பாடல்', intent: 'tamil_search', conversion: 'low' },
    { query: 'அப்பா நினைவு பாடல்', intent: 'tamil_search', conversion: 'high' },
    { query: 'அப்பா பாசம் பாடல்', intent: 'tamil_search', conversion: 'medium' },
    { query: 'தந்தை நினைவு பாடல்', intent: 'tamil_search', conversion: 'medium' },
    { query: 'அப்பாவை இழந்த பாடல்', intent: 'tamil_search', conversion: 'high' },
    { query: 'tamil grief song', intent: 'grief', conversion: 'medium' },
    { query: 'tamil song for lost parent', intent: 'grief', conversion: 'medium' },
    { query: 'emotional song about dad tamil', intent: 'grief', conversion: 'medium' },
    { query: 'original tamil father song', intent: 'discovery', conversion: 'low' },
    { query: 'new tamil emotional song 2026', intent: 'discovery', conversion: 'low' },
  ],
};

export const SONG_QUERY_SETS: SongQuerySet[] = [ANBAI_SUMANTHU];

export function querySetFor(videoId: string): SongQuerySet | undefined {
  return SONG_QUERY_SETS.find((s) => s.videoId === videoId);
}
