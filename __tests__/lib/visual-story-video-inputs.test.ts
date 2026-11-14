/** One clip's inputs and price: exactly what is sent to Grok, priced at xAI's measured rates. */
import { clipPriceUsd, MAX_REFERENCE_IMAGES, selectVideoInputs } from '@/lib/visual-story-video-inputs';
import type { Candidate, Character, Shot } from '@/types/visualStory';

const shot = (over: Partial<Shot> = {}): Shot => ({
  sceneOrder: 1, shotOrder: 1, mode: 'HERO', durationSec: 6, startSec: 0, visualPrompt: 'p', negativePrompt: '',
  charIds: [], selectedCandidateId: null, ...over,
});
const still = (candId: string, shotOrder = 1): Candidate => ({
  candId, sceneOrder: 1, shotOrder, jobId: null, providerId: 'upload', providerTaskId: null, mode: 'STILL',
  s3Key: `k/${candId}.png`, costUsd: 0, createdAt: 't',
});
const char = (charId: string, refs: number): Character => ({
  charId, name: charId, description: '', refImageKeys: Array.from({ length: refs }, (_, i) => `r/${charId}${i}.jpg`), createdAt: 't',
});

describe('clipPriceUsd', () => {
  it('a picture and no faces: 1080p, seconds × $0.25 + $0.01', () => {
    expect(clipPriceUsd({ characters: [], candidates: [still('cd_p')] }, shot({ selectedCandidateId: 'cd_p' }))).toBeCloseTo(1.51, 6);
  });
  it('faces ticked: 720p, seconds × $0.14 + $0.01 per image (2 faces + the picture)', () => {
    const t = { characters: [char('a', 2)], candidates: [still('cd_p')] };
    expect(clipPriceUsd(t, shot({ selectedCandidateId: 'cd_p', charIds: ['a'] }))).toBeCloseTo(0.87, 6);
  });
  it('a row in tenths is priced as the whole seconds Grok makes (13.2 s → 14 s)', () => {
    expect(clipPriceUsd({ characters: [], candidates: [] }, shot({ durationSec: 13.2 }))).toBeCloseTo(3.5, 6);
  });
  it('a chained row is priced with the frame it will get just before its clip', () => {
    expect(clipPriceUsd({ characters: [], candidates: [] }, shot(), { assumeFirstFrame: true })).toBeCloseTo(1.51, 6);
  });
});

describe('selectVideoInputs', () => {
  it('caps the faces at xAI\'s 14, in tick order, and never counts a picture of another row', () => {
    const t = { characters: [char('a', 10), char('b', 10)], candidates: [still('cd_x', 2)] };
    const got = selectVideoInputs(t, shot({ charIds: ['a', 'b'], selectedCandidateId: 'cd_x' }));
    expect(MAX_REFERENCE_IMAGES).toBe(14);
    expect(got.refKeys).toHaveLength(14);
    expect(got.refKeysByCast.map((k) => k.length)).toEqual([10, 4]);
    expect(got.firstFrame).toBeUndefined();
  });
});

describe('clipPriceUsd with the story set to 720p', () => {
  it('prices a picture-only clip at 720p (6 s + picture = $0.85)', () => {
    expect(clipPriceUsd({ characters: [], candidates: [still('cd_p')], clipQuality: '720p' }, shot({ selectedCandidateId: 'cd_p' }))).toBeCloseTo(0.85, 6);
  });
});
