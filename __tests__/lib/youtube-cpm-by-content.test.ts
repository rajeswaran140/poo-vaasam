/**
 * CPM-by-content helper — filter / annotate / sort logic for the per-video
 * playback-based CPM view.
 */

import { annotateAndSortCpmRows } from '@/lib/youtube-cpm-by-content';
import type { CpmByVideoRow } from '@/lib/youtube-analytics';

interface Meta {
  title: string;
  thumbnail: string;
  publishedAt: string;
}
const lookup = (m: Record<string, Meta>) => ({ get: (id: string) => m[id] });

const raw = (v: Partial<CpmByVideoRow> & Pick<CpmByVideoRow, 'videoId'>): CpmByVideoRow => ({
  views: 1000,
  monetizedPlaybacks: 500,
  playbackBasedCpm: 1.0,
  estimatedRevenue: 0.5,
  ...v,
});

const REF_NOW = new Date('2026-08-28T12:00:00Z');

describe('annotateAndSortCpmRows', () => {
  it('drops rows below the min-monetized-playbacks noise floor', () => {
    const rows = annotateAndSortCpmRows(
      [raw({ videoId: 'A', monetizedPlaybacks: 50 }), raw({ videoId: 'B', monetizedPlaybacks: 500 })],
      lookup({
        A: { title: 'A', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' },
        B: { title: 'B', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' },
      }),
      REF_NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].videoId).toBe('B');
  });

  it('drops rows we have no metadata for — a bare video id is worse than a shorter table', () => {
    const rows = annotateAndSortCpmRows(
      [raw({ videoId: 'known' }), raw({ videoId: 'unknown' })],
      lookup({ known: { title: 'Known', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' } }),
      REF_NOW
    );
    expect(rows.map((r) => r.videoId)).toEqual(['known']);
  });

  it('joins title + thumbnail + publishedAt from the metadata lookup', () => {
    const rows = annotateAndSortCpmRows(
      [raw({ videoId: 'X' })],
      lookup({ X: { title: 'The Song', thumbnail: 'https://i/x.jpg', publishedAt: '2026-06-01T00:00:00Z' } }),
      REF_NOW
    );
    expect(rows[0].title).toBe('The Song');
    expect(rows[0].thumbnail).toBe('https://i/x.jpg');
    expect(rows[0].publishedAt).toBe('2026-06-01T00:00:00Z');
  });

  it('marks pending when CPM is 0 AND the video is younger than the pending-age window', () => {
    const rows = annotateAndSortCpmRows(
      [raw({ videoId: 'young', playbackBasedCpm: 0 })],
      lookup({ young: { title: 'young', thumbnail: 't', publishedAt: '2026-08-27T00:00:00Z' } }),
      REF_NOW
    );
    expect(rows[0].pending).toBe(true);
  });

  it('does NOT mark pending when CPM is 0 but the video is OLD — that is a real "no monetization" signal', () => {
    const rows = annotateAndSortCpmRows(
      [raw({ videoId: 'old', playbackBasedCpm: 0 })],
      lookup({ old: { title: 'old', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' } }),
      REF_NOW
    );
    expect(rows[0].pending).toBe(false);
  });

  it('does NOT mark pending when CPM is non-zero — pending is specifically the "no data yet" case', () => {
    const rows = annotateAndSortCpmRows(
      [raw({ videoId: 'young', playbackBasedCpm: 0.42 })],
      lookup({ young: { title: 'young', thumbnail: 't', publishedAt: '2026-08-27T00:00:00Z' } }),
      REF_NOW
    );
    expect(rows[0].pending).toBe(false);
  });

  it('sorts by CPM descending — highest-value audiences first', () => {
    const rows = annotateAndSortCpmRows(
      [
        raw({ videoId: 'low', playbackBasedCpm: 0.5 }),
        raw({ videoId: 'high', playbackBasedCpm: 2.0 }),
        raw({ videoId: 'mid', playbackBasedCpm: 1.2 }),
      ],
      lookup({
        low: { title: 'low', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' },
        high: { title: 'high', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' },
        mid: { title: 'mid', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' },
      }),
      REF_NOW
    );
    expect(rows.map((r) => r.videoId)).toEqual(['high', 'mid', 'low']);
  });

  it('sinks pending rows to the bottom regardless of CPM value — a $0 pending row at the top would misread as worst monetizer', () => {
    const rows = annotateAndSortCpmRows(
      [
        raw({ videoId: 'pending', playbackBasedCpm: 0 }),
        raw({ videoId: 'settled-low', playbackBasedCpm: 0.5 }),
        raw({ videoId: 'settled-high', playbackBasedCpm: 2.0 }),
      ],
      lookup({
        pending: { title: 'pending', thumbnail: 't', publishedAt: '2026-08-27T00:00:00Z' },
        'settled-low': { title: 'sl', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' },
        'settled-high': { title: 'sh', thumbnail: 't', publishedAt: '2026-06-01T00:00:00Z' },
      }),
      REF_NOW
    );
    expect(rows.map((r) => r.videoId)).toEqual(['settled-high', 'settled-low', 'pending']);
  });

  it('honours custom min-playbacks + pending-age options', () => {
    const rows = annotateAndSortCpmRows(
      [
        raw({ videoId: 'A', monetizedPlaybacks: 200, playbackBasedCpm: 0 }),
        raw({ videoId: 'B', monetizedPlaybacks: 200, playbackBasedCpm: 1.0 }),
      ],
      lookup({
        A: { title: 'A', thumbnail: 't', publishedAt: '2026-08-25T00:00:00Z' },
        B: { title: 'B', thumbnail: 't', publishedAt: '2026-08-25T00:00:00Z' },
      }),
      REF_NOW,
      { minMonetizedPlaybacks: 300, pendingAgeDays: 7 }
    );
    // minMonetizedPlaybacks=300 drops both rows.
    expect(rows).toHaveLength(0);
  });
});
