/** @jest-environment node */
/**
 * The caption policy: our lyrics or nothing.
 *
 * Raj set it on 2026-09-20 — *"we have to turn off all automatic captions
 * unless we uploaded our lyrics"* — after seven hand-deletions in two days, two
 * of which came back within hours. These tests pin the two decisions that would
 * quietly break it: deleting a track a person uploaded, and mis-costing the
 * quota so a sweep dies halfway through the catalogue.
 */
import {
  decideCaptions,
  isUploadedTrack,
  sweepCost,
  canAfford,
  COST_CAPTIONS_LIST,
  COST_CAPTIONS_DELETE,
  type CaptionTrack,
} from '@/lib/caption-policy';

const asr = (id: string, language = 'en'): CaptionTrack => ({ id, trackKind: 'asr', language });
const ours = (id: string, language = 'ta'): CaptionTrack => ({ id, trackKind: 'standard', language });

describe('what counts as ours', () => {
  it('treats anything not asr as human-uploaded', () => {
    expect(isUploadedTrack(ours('a'))).toBe(true);
    expect(isUploadedTrack({ id: 'b', trackKind: 'forced', language: 'ta' })).toBe(true);
    expect(isUploadedTrack(asr('c'))).toBe(false);
  });
});

describe('deciding one video', () => {
  it('removes an English machine track', () => {
    expect(decideCaptions([asr('x')])).toEqual({ action: 'delete', trackIds: ['x'], keepsCaptions: false });
  });

  /**
   * ⚠️ A TAMIL asr track goes too. It is still a machine's guess at sung Tamil,
   * and the policy is our lyrics or nothing. This is the case most likely to be
   * "helpfully" exempted later.
   */
  it('removes a Tamil machine track as well', () => {
    const v = decideCaptions([asr('t', 'ta')]);
    expect(v.action).toBe('delete');
    if (v.action === 'delete') expect(v.trackIds).toEqual(['t']);
  });

  it('NEVER removes a track we uploaded', () => {
    expect(decideCaptions([ours('mine')])).toEqual({ action: 'none', keepsCaptions: true });
  });

  it('removes the machine track and keeps ours, when both exist', () => {
    const v = decideCaptions([asr('robot'), ours('mine')]);
    expect(v).toEqual({ action: 'delete', trackIds: ['robot'], keepsCaptions: true });
  });

  it('reports a video left with no captions, which is the gap worth filling', () => {
    const v = decideCaptions([asr('a'), asr('b')]);
    expect(v.keepsCaptions).toBe(false);
    if (v.action === 'delete') expect(v.trackIds).toEqual(['a', 'b']);
  });

  it('does nothing to a video that has no tracks at all', () => {
    expect(decideCaptions([])).toEqual({ action: 'none', keepsCaptions: false });
  });
});

describe('quota, because reading 50 as 1 cost a whole day once', () => {
  it('costs a list per video and a delete per track', () => {
    expect(sweepCost(2, 3, 1)).toBe(1 + 2 * COST_CAPTIONS_LIST + 3 * COST_CAPTIONS_DELETE);
  });

  it('prices a full catalogue pass honestly', () => {
    // 124 videos, 3 playlist pages, worst case one delete each.
    expect(sweepCost(124, 124, 3)).toBe(3 + 124 * 50 + 124 * 50);
    expect(sweepCost(124, 0, 3)).toBe(6203);
  });

  /** Budgeting for the BEST case is how a sweep dies halfway and leaves no record. */
  it('refuses unless the WORST case fits', () => {
    // 10 videos: 10*50 list + 10*50 delete + 1 = 1001 units worst case.
    expect(canAfford(10, 1, 1001)).toBe(true);
    expect(canAfford(10, 1, 1000)).toBe(false);
    // It must not be fooled by the no-deletions case fitting.
    expect(sweepCost(10, 0, 1)).toBe(501);
    expect(canAfford(10, 1, 501)).toBe(false);
  });
});
