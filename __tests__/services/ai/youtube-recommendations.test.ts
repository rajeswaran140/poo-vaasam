/** @jest-environment node */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create } })),
}));

import {
  generateYouTubeRecommendations,
  parseRecs,
} from '@/services/ai/youtube-recommendations';

const originalEnv = process.env.ANTHROPIC_API_KEY;
const originalEngine = process.env.AUX_AI_ENGINE;

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  // ⚠️ PIN THE ENGINE. These tests mock the Anthropic client, so they only make
  // sense with the Anthropic adapter selected. They used to inherit whatever
  // `AUX_AI_ENGINE` the surrounding environment had — which was nothing locally
  // and nothing in CI, so the dependency stayed invisible until
  // `AUX_AI_ENGINE=openai` was set on the Amplify app (2026-08-17) to revive
  // the auxiliary AI layer. The next build then FAILED on 4 of these tests
  // (job 575) and the deploy was cancelled: a config change in the console
  // broke a test suite that never named the variable it depended on.
  delete process.env.AUX_AI_ENGINE;
});

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
  if (originalEngine === undefined) delete process.env.AUX_AI_ENGINE;
  else process.env.AUX_AI_ENGINE = originalEngine;
});

const INPUT = {
  channel: {
    views: 1000,
    estimatedMinutesWatched: 300,
    averageViewDuration: 90,
    subscribersGained: 3,
    subscribersLost: 0,
    daysBack: 28,
  },
  videos: [
    { videoId: 'vid1', views: 800, estimatedMinutesWatched: 200, averageViewDuration: 95, subscribersGained: 2 },
    { videoId: 'vid2', views: 200, estimatedMinutesWatched: 100, averageViewDuration: 60, subscribersGained: 1 },
  ],
  titles: { vid1: 'அந்தி மேகமே', vid2: 'என்ன மாயம்' },
};

const claudeResp = (text: string) => ({ content: [{ type: 'text', text }] });

describe('parseRecs', () => {
  it('parses a clean JSON array', () => {
    expect(parseRecs('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });
  it('strips ```json fences', () => {
    expect(parseRecs('```json\n["a","b"]\n```')).toEqual(['a', 'b']);
  });
  it('drops empty strings', () => {
    expect(parseRecs('["a","","b"]')).toEqual(['a', 'b']);
  });
  it('throws when not an array', () => {
    expect(() => parseRecs('"not an array"')).toThrow(/array/);
  });
});

describe('generateYouTubeRecommendations', () => {
  it('returns ok=false when no video data is supplied', async () => {
    const r = await generateYouTubeRecommendations({ ...INPUT, videos: [] });
    expect(r.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns ok=false when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await generateYouTubeRecommendations(INPUT);
    expect(r.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns parsed recs on a clean response', async () => {
    create.mockResolvedValueOnce(claudeResp('["Anthi Megame is outperforming — make 2 Shorts.","Pin a comment poll."]'));
    const r = await generateYouTubeRecommendations(INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toHaveLength(2);
  });

  it('surfaces upstream errors', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error('rate limited'));
    const r = await generateYouTubeRecommendations(INPUT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/failed|try again/i); // classified by the text engine
  });

  it('sends a compact payload (top 10 videos, title from lookup)', async () => {
    create.mockResolvedValueOnce(claudeResp('["x"]'));
    await generateYouTubeRecommendations(INPUT);
    const userMsg = create.mock.calls[0]?.[0]?.messages?.[0]?.content as string;
    const parsed = JSON.parse(userMsg);
    expect(parsed.videos).toHaveLength(2);
    expect(parsed.videos[0].title).toBe('அந்தி மேகமே');
    expect(parsed.days).toBe(28);
  });
});
