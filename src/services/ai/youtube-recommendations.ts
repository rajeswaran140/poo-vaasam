/**
 * AI YouTube recommendations — feed a structured analytics summary to
 * Claude and get back 3–5 short, specific actions to grow the channel.
 *
 * Pure function: caller pre-fetches the analytics, this only handles the
 * prompt + parsing. Output is a list of strings so the dashboard can
 * render them as bullets without extra formatting.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { VideoAnalyticsRow, ChannelAnalyticsSnapshot } from '@/lib/youtube-analytics';

const MODEL = 'claude-sonnet-4-6';

export type RecResult = { ok: true; data: string[] } | { ok: false; error: string };

interface Input {
  channel: ChannelAnalyticsSnapshot;
  videos: VideoAnalyticsRow[];
  /** Optional title lookup (videoId → title) so recs can name songs. */
  titles?: Record<string, string>;
}

function getClient(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || key === 'dummy-key-for-build') return null;
  return new Anthropic({ apiKey: key });
}

const SYSTEM_PROMPT = `You are a YouTube channel-growth advisor for a Tamil songwriter / lyricist (channel: Rajeswaran Thangarajah, ~15 subscribers, focused on original Tamil songs and poems with single-creator publishing).

You are given a JSON object: channel-wide stats for the last N days plus the top videos by subscribers gained. Each video has views, watch-time, average view duration, and subscribers gained.

Produce 3–5 short, SPECIFIC recommendations. Output ONE JSON array of strings and nothing else (no prose, no markdown fence):

["<rec 1>", "<rec 2>", ...]

Rules:
- Each rec ≤ 25 words. Concrete and actionable — name the song/title when relevant ("Anthi Megame is outperforming…"), say what to do next ("create 2 Shorts from the chorus", "pin a comment with a poll", "promote on Facebook").
- Avoid generic advice ("post consistently"). Tie everything to the data.
- If a video has very low retention (averageViewDuration < 30s on a 4+ minute video), call it out as a thumbnail / opening hook problem.
- If subscribers are flatlining (gained ≤ 1 over 28d), the headline rec should be a discovery move (Shorts, Reels, cross-post).
- Mix tactical (next 7 days) and structural (next 30 days). Don't just list 5 tactical Shorts.`;

export async function generateYouTubeRecommendations(input: Input): Promise<RecResult> {
  if (!input.videos.length) {
    return { ok: false, error: 'No video analytics to reason from' };
  }
  const client = getClient();
  if (!client) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };

  // Compact, model-friendly payload — drop the long Tamil titles into a
  // separate map so the row data stays terse.
  const payload = {
    days: input.channel.daysBack,
    channel: {
      views: input.channel.views,
      subscribersGained: input.channel.subscribersGained,
      subscribersLost: input.channel.subscribersLost,
      watchTimeMinutes: input.channel.estimatedMinutesWatched,
      averageViewDurationSeconds: input.channel.averageViewDuration,
    },
    videos: input.videos.slice(0, 10).map((v) => ({
      videoId: v.videoId,
      title: input.titles?.[v.videoId] ?? '(unknown)',
      views: v.views,
      subscribersGained: v.subscribersGained,
      averageViewDurationSeconds: v.averageViewDuration,
      watchTimeMinutes: v.estimatedMinutesWatched,
    })),
  };

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
    return { ok: true, data: parseRecs(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ai/youtube-recs] failed:', msg);
    return { ok: false, error: msg };
  }
}

/** Tolerant JSON-array extraction — strips ```json fences if Claude adds them. */
export function parseRecs(raw: string): string[] {
  let cleaned = raw.trim();
  const fence = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) cleaned = fence[1].trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('Recommendations must be a JSON array');
  return parsed.map(String).filter((s) => s.trim().length > 0);
}
