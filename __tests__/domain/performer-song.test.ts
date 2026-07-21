/** @jest-environment node */
/**
 * PerformerSong read-model + Content round-trip for the gated performer fields.
 * Proves the gated lyrics/key never leak into the wrong JSON shape and that a
 * song is only projected when PUBLISHED + performable.
 */

import { Content } from '@/domain/entities/Content';
import { PerformerSong } from '@/domain/songs/PerformerSong';

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: 'cnt_1',
  type: 'SONGS',
  title: 'அம்மா',
  titleSlug: 'amma',
  body: 'placeholder',
  description: '',
  author: 'இராஜ்',
  status: 'PUBLISHED',
  featuredImage: 'https://cdn.example/cover.png',
  audioUrl: 'https://cdn.example/a.mp3',
  audioDuration: 240,
  categoryIds: [],
  tagIds: [],
  viewCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  publishedAt: '2026-01-01T00:00:00.000Z',
  lyrics: 'பல்லவி\nஅம்மா...',
  instrumentalKey: 'audio/instrumentals/cnt_1.mp3',
  instrumentalDuration: 230,
  ...over,
});

describe('Content round-trip — performer fields', () => {
  it('preserves lyrics / instrumentalKey / instrumentalDuration through fromObject→toObject', () => {
    const obj = Content.fromObject(baseRow()).toObject();
    expect(obj.lyrics).toBe('பல்லவி\nஅம்மா...');
    expect(obj.instrumentalKey).toBe('audio/instrumentals/cnt_1.mp3');
    expect(obj.instrumentalDuration).toBe(230);
  });

  // Re-integration guard: emotionAnalysis (master) and the performer fields
  // (lyrics/instrumentalKey/instrumentalDuration) are adjacent tail-of-constructor
  // slots added from different sides. lyrics + instrumentalKey are both
  // `string | undefined`, so a positional swap would compile cleanly — only a
  // round-trip with DISTINCT values catches it. Co-exercise them together.
  it('preserves emotionAnalysis ALONGSIDE the performer fields (adjacency, distinct values)', () => {
    const emotionAnalysis = {
      emotion: 'longing',
      mood: 'wistful',
      themes: ['mother'],
      musicRecommendation: 'soft strings',
      ttsSpeed: 0.95,
      ttsPitch: -1,
      summary: 'a gentle ache',
    };
    const obj = Content.fromObject(baseRow({ emotionAnalysis })).toObject();
    expect(obj.emotionAnalysis).toEqual(emotionAnalysis); // master's slot, unswapped
    expect(obj.lyrics).toBe('பல்லவி\nஅம்மா...'); // NOT the key, NOT the analysis
    expect(obj.instrumentalKey).toBe('audio/instrumentals/cnt_1.mp3'); // NOT the lyrics
    expect(obj.instrumentalDuration).toBe(230);
  });
});

describe('PerformerSong.fromContent', () => {
  it('projects a published, performable song', () => {
    const song = PerformerSong.fromContent(Content.fromObject(baseRow()));
    expect(song).not.toBeNull();
    expect(song!.title).toBe('அம்மா');
    expect(song!.lyrics).toContain('பல்லவி');
    expect(song!.instrumentalKey).toBe('audio/instrumentals/cnt_1.mp3');
    expect(song!.durationSeconds).toBe(230);
  });

  it('returns null when not published', () => {
    expect(PerformerSong.fromContent(Content.fromObject(baseRow({ status: 'DRAFT' })))).toBeNull();
  });

  it('returns null when not performable (no lyrics)', () => {
    expect(PerformerSong.fromContent(Content.fromObject(baseRow({ lyrics: undefined })))).toBeNull();
  });

  it('returns null when not performable (no backing track)', () => {
    expect(PerformerSong.fromContent(Content.fromObject(baseRow({ instrumentalKey: undefined })))).toBeNull();
  });

  it('list JSON exposes neither lyrics nor the backing-track key', () => {
    const list = PerformerSong.fromContent(Content.fromObject(baseRow()))!.toListJSON();
    expect(list).not.toHaveProperty('lyrics');
    expect(list).not.toHaveProperty('instrumentalKey');
    expect(list.title).toBe('அம்மா');
    expect(list.durationSeconds).toBe(230);
  });

  it('detail JSON exposes lyrics but never the raw S3 key', () => {
    const detail = PerformerSong.fromContent(Content.fromObject(baseRow()))!.toDetailJSON();
    expect(detail.lyrics).toContain('அம்மா');
    expect(detail).not.toHaveProperty('instrumentalKey');
  });
});
