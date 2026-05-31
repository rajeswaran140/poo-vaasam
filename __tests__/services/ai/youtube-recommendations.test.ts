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

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
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
    if (!r.ok) expect(r.error).toMatch(/rate/);
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
