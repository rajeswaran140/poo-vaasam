/**
 * GET /api/admin/youtube/release-check?videoId=XXXXXXXXXXX
 *
 * Gathers one upload's real state from YouTube and runs it through the release
 * checklist (lib/release-checklist, pure + tested).
 *
 * WHY THIS EXISTS: four uploads shipped between 2026-07-28 and 07-30 and every
 * one was missing something different — wrong audio language, no romanized
 * title, a teaser that named its premiere without linking it, an English
 * auto-caption on a Tamil song. None is hard to notice; all are easy to miss at
 * upload time, by hand, on the fifth release in three days.
 *
 * ⚠️ QUOTA: `captions.list` costs **50 units**, not 1 — misreading that burned
 * a whole day's 10,000-unit budget on 2026-07-29. One check ≈ 56 units, so this
 * route charges the durable ledger (lib/youtube-quota) BEFORE calling Google
 * and refuses when the guard trips. Roughly 170 checks/day are affordable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { consumeQuota, QUOTA_COST } from '@/lib/youtube-quota';
import {
  summariseRelease,
  SHORTS_PLAYLIST_ID,
  ALL_SONGS_PLAYLIST_ID,
  LATEST_PLAYLIST_ID,
  type VideoSnapshot,
} from '@/lib/release-checklist';

export const dynamic = 'force-dynamic';

/** captions.list is the expensive one — see the quota note above. */
const CAPTIONS_LIST_COST = 50;
const PLAYLISTS_TO_CHECK = [SHORTS_PLAYLIST_ID, ALL_SONGS_PLAYLIST_ID, LATEST_PLAYLIST_ID];

/** Shorts are at most 3 minutes; every song in this catalogue is longer. */
const SHORT_MAX_SECONDS = 180;

/** "PT7M35S" → 455 */
function parseIsoDuration(iso: string): number {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? '');
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

async function mintWriteToken(): Promise<string | null> {
  const id = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const secret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  // Captions need force-ssl, which only the WRITE token carries. The analytics
  // token cannot read caption tracks at all.
  const refresh = process.env.YOUTUBE_WRITE_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const videoId = request.nextUrl.searchParams.get('videoId');
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return NextResponse.json(
      { error: { code: 'BAD_VIDEO_ID', message: 'videoId must be an 11-character YouTube id' } },
      { status: 400 }
    );
  }

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: { code: 'NOT_CONFIGURED', message: 'YOUTUBE_API_KEY is not set' } },
      { status: 503 }
    );
  }

  // Charge before spending, so a runaway caller is stopped by our own ledger.
  // Playlist membership may need several pages each — budget 3 per playlist.
  const cost = QUOTA_COST.videosList + CAPTIONS_LIST_COST + PLAYLISTS_TO_CHECK.length * 3;
  const quota = await consumeQuota(cost, { surface: 'data' });
  if (quota.blocked) {
    return NextResponse.json(
      {
        error: {
          code: 'QUOTA_GUARD',
          message: `Data API quota guard tripped (${quota.used}/${quota.limit} for ${quota.day} Pacific). Resets at midnight PT.`,
        },
      },
      { status: 429 }
    );
  }

  try {
    const vRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${key}`
    );
    const vJson = (await vRes.json()) as { items?: Array<Record<string, any>>; error?: { message: string } };
    if (vJson.error) throw new Error(vJson.error.message);
    const item = vJson.items?.[0];
    if (!item) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: `No video ${videoId} on this channel` } },
        { status: 404 }
      );
    }

    const snippet = item.snippet ?? {};
    const durationSeconds = parseIsoDuration(item.contentDetails?.duration ?? '');
    const isShort =
      durationSeconds > 0 && durationSeconds <= SHORT_MAX_SECONDS
        ? true
        : /#shorts/i.test(String(snippet.title ?? ''));

    // Captions need the write token's force-ssl scope. If it is absent we
    // report that honestly rather than silently claiming there are no tracks —
    // "no captions" and "could not look" are different answers.
    let captionTracks: Array<{ trackKind: string; language: string }> = [];
    let captionsChecked = false;
    const token = await mintWriteToken();
    if (token) {
      const cRes = await fetch(
        `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const cJson = (await cRes.json()) as { items?: Array<Record<string, any>> };
      if (cRes.ok) {
        captionsChecked = true;
        captionTracks = (cJson.items ?? []).map((t) => ({
          trackKind: String(t.snippet?.trackKind ?? ''),
          language: String(t.snippet?.language ?? ''),
        }));
      }
    }

    // MUST PAGINATE. "All Songs" holds 54 items and a single maxResults=50 page
    // silently misses positions 51+, reporting a video as absent when it is
    // present — which is exactly what a first version of this route did.
    const playlistIds: string[] = [];
    for (const pid of PLAYLISTS_TO_CHECK) {
      let pageToken = '';
      let found = false;
      for (let page = 0; page < 10 && !found; page++) {
        const pRes = await fetch(
          `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${pid}` +
            `&maxResults=50&key=${key}${pageToken ? `&pageToken=${pageToken}` : ''}`
        );
        const pJson = (await pRes.json()) as {
          items?: Array<Record<string, any>>;
          nextPageToken?: string;
        };
        if ((pJson.items ?? []).some((i) => i.contentDetails?.videoId === videoId)) found = true;
        if (!pJson.nextPageToken) break;
        pageToken = pJson.nextPageToken;
      }
      if (found) playlistIds.push(pid);
    }

    const snapshot: VideoSnapshot = {
      videoId,
      title: String(snippet.title ?? ''),
      description: String(snippet.description ?? ''),
      tags: Array.isArray(snippet.tags) ? snippet.tags.map(String) : [],
      categoryId: String(snippet.categoryId ?? ''),
      defaultLanguage: snippet.defaultLanguage,
      defaultAudioLanguage: snippet.defaultAudioLanguage,
      hasCustomThumbnail: Boolean(snippet.thumbnails?.maxres),
      isShort,
      playlistIds,
      captionTracks,
      isUpcoming: snippet.liveBroadcastContent === 'upcoming',
    };

    const summary = summariseRelease(snapshot);

    return NextResponse.json(
      {
        ...summary,
        title: snapshot.title,
        isShort,
        durationSeconds,
        isUpcoming: snapshot.isUpcoming,
        captionsChecked,
        quota: { used: quota.used, limit: quota.limit, spent: cost },
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } }
    );
  } catch (err) {
    console.error('[release-check] failed:', err);
    return NextResponse.json(
      {
        error: {
          code: 'RELEASE_CHECK_FAILED',
          message: err instanceof Error ? err.message : 'release check failed',
        },
      },
      { status: 502 }
    );
  }
}
