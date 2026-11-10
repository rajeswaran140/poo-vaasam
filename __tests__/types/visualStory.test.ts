import {
  createStorySchema,
  shotInputSchema,
  sceneInputSchema,
  characterInputSchema,
  draftRequestSchema,
  deriveStartSecs,
  tilesWindow,
  isVsId,
  isCharId,
  isCandId,
  isDraftId,
  newId,
} from '@/types/visualStory';

const base = {
  masterJobId: 'abc-1',
  title: 'Test song',
  aspectRatio: '9:16',
  windowStartSec: 10,
  windowEndSec: 70,
};

describe('createStorySchema', () => {
  it('accepts a valid body', () => {
    expect(createStorySchema.safeParse(base).success).toBe(true);
  });
  it('accepts optional contentId and budgetUsdCap', () => {
    expect(createStorySchema.safeParse({ ...base, contentId: 'c1', budgetUsdCap: 40 }).success).toBe(true);
    expect(createStorySchema.safeParse({ ...base, budgetUsdCap: 501 }).success).toBe(false);
  });
  it.each([29, 421])('rejects a window of %i s with the 30–420 message', (len) => {
    const r = createStorySchema.safeParse({ ...base, windowEndSec: base.windowStartSec + len });
    expect(r.success).toBe(false);
    if (!r.success) expect(JSON.stringify(r.error.issues)).toContain('30–420');
  });
  it('accepts the 30 s and 420 s (seven-minute) edges', () => {
    expect(createStorySchema.safeParse({ ...base, windowEndSec: 40 }).success).toBe(true);
    expect(createStorySchema.safeParse({ ...base, windowEndSec: 430 }).success).toBe(true);
  });
  it('rejects an unsupported aspect ratio', () => {
    expect(createStorySchema.safeParse({ ...base, aspectRatio: '1:1' }).success).toBe(false);
  });
  it('rejects a negative start and an empty title', () => {
    expect(createStorySchema.safeParse({ ...base, windowStartSec: -1 }).success).toBe(false);
    expect(createStorySchema.safeParse({ ...base, title: '' }).success).toBe(false);
  });
});

describe('shotInputSchema', () => {
  const shot = { mode: 'STILL', durationSec: 5, visualPrompt: 'A lane at dusk', negativePrompt: '', charIds: [] };
  it('accepts a valid shot', () => {
    expect(shotInputSchema.safeParse(shot).success).toBe(true);
  });
  it.each([0, 61, 2.5])('rejects durationSec %s', (d) => {
    expect(shotInputSchema.safeParse({ ...shot, durationSec: d }).success).toBe(false);
  });
  it('accepts up to 60 s (a row holding your own clip takes its length; Grok is capped at 15 by the video route)', () => {
    expect(shotInputSchema.safeParse({ ...shot, durationSec: 60 }).success).toBe(true);
  });
  it('rejects more than 14 characters and an unknown mode', () => {
    expect(shotInputSchema.safeParse({ ...shot, charIds: Array(15).fill('ch_1793000000000_abc123') }).success).toBe(false);
    expect(shotInputSchema.safeParse({ ...shot, mode: 'VIDEO' }).success).toBe(false);
  });
});

describe('other input schemas', () => {
  it('scene', () => {
    expect(sceneInputSchema.safeParse({ heading: 'Scene 1', summary: '' }).success).toBe(true);
    expect(sceneInputSchema.safeParse({ heading: '', summary: '' }).success).toBe(false);
    expect(sceneInputSchema.safeParse({ heading: 'x', summary: 'a'.repeat(601) }).success).toBe(false);
  });
  it('character', () => {
    expect(characterInputSchema.safeParse({ name: 'Ana', description: '' }).success).toBe(true);
    expect(characterInputSchema.safeParse({ name: 'a'.repeat(61), description: '' }).success).toBe(false);
  });
  it('draft request trims and bounds lyrics', () => {
    expect(draftRequestSchema.safeParse({ lyrics: '   ' }).success).toBe(false);
    const r = draftRequestSchema.safeParse({ lyrics: '  la la  ' });
    expect(r.success && r.data.lyrics).toBe('la la');
    expect(draftRequestSchema.safeParse({ lyrics: 'a'.repeat(8001) }).success).toBe(false);
  });
});

describe('timeline helpers', () => {
  it('deriveStartSecs is cumulative from 0', () => {
    expect(deriveStartSecs([{ durationSec: 5 }, { durationSec: 8 }, { durationSec: 2 }])).toEqual([0, 5, 13]);
    expect(deriveStartSecs([])).toEqual([]);
  });
  it('tilesWindow compares the sum to the window', () => {
    expect(tilesWindow([{ durationSec: 30 }, { durationSec: 30 }], 60)).toBe(true);
    expect(tilesWindow([{ durationSec: 30 }, { durationSec: 29 }], 60)).toBe(false);
  });
});

describe('ids', () => {
  it('validates vs ids', () => {
    expect(isVsId('vs_1793000000000_abc123')).toBe(true);
    expect(isVsId('VSTORY#x')).toBe(false);
    expect(isVsId('ch_1793000000000_abc123')).toBe(false);
  });
  it('newId round-trips through each guard', () => {
    expect(isVsId(newId('vs'))).toBe(true);
    expect(isCharId(newId('ch'))).toBe(true);
    expect(isCandId(newId('cd'))).toBe(true);
    expect(isDraftId(newId('dr'))).toBe(true);
    expect(isCharId(newId('cd'))).toBe(false);
  });
});
