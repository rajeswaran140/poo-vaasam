/**
 * Content entity — the precomputed emotionAnalysis field: it must survive the
 * toObject → DynamoDB → fromObject round-trip, and fromObject must tolerate
 * legacy rows that don't carry it.
 */
import { Content } from '@/domain/entities/Content';
import { ContentType, type EmotionAnalysis } from '@/types/content';

const analysis: EmotionAnalysis = {
  emotion: 'joyful',
  mood: 'uplifting',
  themes: ['மகிழ்ச்சி'],
  musicRecommendation: 'uplifting_strings',
  ttsSpeed: 1.1,
  ttsPitch: 1.1,
  summary: 'மகிழ்ச்சியான கவிதை',
};

const makePoem = () =>
  Content.create({
    type: ContentType.POEMS,
    title: 'தலைப்பு',
    body: 'உடல் வரிகள்',
    description: 'விளக்கம்',
    author: 'Raj',
  });

it('is undefined on a freshly created poem', () => {
  expect(makePoem().emotionAnalysis).toBeUndefined();
});

it('round-trips through toObject/fromObject', () => {
  const c = makePoem();
  c.setEmotionAnalysis(analysis);
  expect(c.emotionAnalysis).toEqual(analysis);

  const obj = c.toObject();
  expect(obj.emotionAnalysis).toEqual(analysis);

  const restored = Content.fromObject(obj);
  expect(restored.emotionAnalysis).toEqual(analysis);
});

it('fromObject tolerates a missing or malformed emotionAnalysis (legacy rows)', () => {
  const obj = makePoem().toObject();
  expect(Content.fromObject({ ...obj, emotionAnalysis: undefined }).emotionAnalysis).toBeUndefined();
  expect(Content.fromObject({ ...obj, emotionAnalysis: 'garbage' }).emotionAnalysis).toBeUndefined();
});

it('setEmotionAnalysis overwrites idempotently and touches updatedAt', () => {
  const c = makePoem();
  const before = c.updatedAt.getTime();
  c.setEmotionAnalysis(analysis);
  expect(c.updatedAt.getTime()).toBeGreaterThanOrEqual(before);

  const next: EmotionAnalysis = { ...analysis, emotion: 'melancholic' };
  c.setEmotionAnalysis(next);
  expect(c.emotionAnalysis?.emotion).toBe('melancholic');
});
