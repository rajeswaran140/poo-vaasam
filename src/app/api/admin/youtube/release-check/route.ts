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

/**
 * The biggest thumbnail on the snippet, by pixel area.
 *
 * Deliberately NOT "is `maxres` present" — release-checklist already records
 * why that boolean is worthless (YouTube generates `maxres` for any HD upload,
 * so it is true for 100% of this catalogue). A width × height plus the URL is
 * something the operator can actually look at.
 */
function largestThumbnail(
  thumbnails: Record<string, { url?: string; width?: number; height?: number }> | undefined
): { name: string; url: string; width: number; height: number } | null {
  let best: { name: string; url: string; width: number; height: number } | null = null;
  for (const [name, t] of Object.entries(thumbnails ?? {})) {
    if (!t?.url) continue;
    const width = Number(t.width ?? 0);
    const height = Number(t.height ?? 0);
    if (!best || width * height > best.width * best.height) {
      best = { name, url: String(t.url), width, height };
    }
  }
  return best;
}

async function mintWriteToken(): Promise<string | null> {
  const id = process.env.YOUTUBE_OAUTH_CLIENT_ID;
  const secret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
  // Captions need force-ssl, which only the Data-API-scope token carries. The
  // Analytics-scope token cannot read caption tracks at all.
  const refresh = process.env.YOUTUBE_DATA_REFRESH_TOKEN;
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
  // The density check adds two more real calls: one playlistItems.list for the
  // uploads feed, and one videos.list for the siblings' liveStreamingDetails.
  // The second of those is CONDITIONAL in the code below (it only runs when
  // the uploads feed returned at least one sibling id) — charged here
  // unconditionally anyway. That is deliberate: a ledger that undercounts is
  // how real usage drifts above the recorded total, and an empty uploads feed
  // is rare enough that the over-charge on that path costs nothing in
  // practice. Over-charging is the safe direction for a quota guard;
  // under-charging is not.
  const cost =
    QUOTA_COST.videosList +
    CAPTIONS_LIST_COST +
    PLAYLISTS_TO_CHECK.length * 3 +
    QUOTA_COST.playlistItemsList +
    QUOTA_COST.videosList;
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
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status,liveStreamingDetails&id=${videoId}&key=${key}`
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
    const live = item.liveStreamingDetails;
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

    // Uploads feed, for the density check. `videoPublishedAt` is upload time;
    // scheduledStartTime/actualStartTime for each sibling is fetched alongside
    // so density can compare air time to air time. A failed fetch here must
    // not throw — it leaves siblingReleases empty, which makes the density
    // check report not-checked instead of silently passing.
    let siblingReleases: VideoSnapshot['siblingReleases'] = [];
    try {
      const feedRes = await fetch(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=UUZCuphXleq-mXVYgvqh-OlQ&maxResults=15&key=${key}`
      );
      const feed = feedRes.ok ? await feedRes.json() : { items: [] };

      const siblingIds = (feed.items ?? [])
        .map((it: { contentDetails?: { videoId?: string } }) => it.contentDetails?.videoId)
        .filter(Boolean) as string[];

      const detailRes = siblingIds.length
        ? await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${siblingIds.join(',')}&key=${key}`
          )
        : null;
      const siblingDetail = detailRes?.ok ? await detailRes.json() : { items: [] };

      // `liveStreamingDetails` PERSISTS after a premiere airs, carrying both
      // `actualStartTime` and `actualEndTime` — so an AIRED sibling is not
      // "no air time known", it is air time known for certain. Track it
      // separately from `scheduledStartTime` (an UNAIRED premiere's planned
      // air time) rather than dropping it, which is what previously pushed
      // aired siblings onto the `publishedAt` (upload time) fallback below —
      // the exact upload-vs-air mismatch this density check exists to catch.
      const schedById = new Map<string, string>();
      const actualById = new Map<string, string>();
      for (const it of siblingDetail.items ?? []) {
        const lsd = it?.liveStreamingDetails;
        if (!it?.id || !lsd) continue;
        if (lsd.actualStartTime) actualById.set(it.id, lsd.actualStartTime);
        else if (lsd.scheduledStartTime) schedById.set(it.id, lsd.scheduledStartTime);
      }

      siblingReleases = (feed.items ?? [])
        .map((it: { contentDetails?: { videoId?: string; videoPublishedAt?: string } }) => ({
          videoId: it.contentDetails?.videoId as string,
          publishedAt: it.contentDetails?.videoPublishedAt as string,
          scheduledStartTime: schedById.get(it.contentDetails?.videoId as string),
          actualStartTime: actualById.get(it.contentDetails?.videoId as string),
        }))
        .filter((r: { videoId?: string; publishedAt?: string }) => r.videoId && r.publishedAt);
    } catch (err) {
      console.error('[release-check] sibling fetch failed:', err);
      siblingReleases = [];
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
      uploadedAt: snippet.publishedAt,
      scheduledStartTime: live?.scheduledStartTime,
      siblingReleases,
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
        /**
         * WHAT YOUTUBE ACTUALLY STORED — read off the SAME `videos.list`
         * response the checklist was graded from, so it costs no extra call
         * and no extra quota. Purely additive: every field above keeps its
         * name and its meaning.
         *
         * The Mastering Studio's upload panel shows these instead of echoing
         * the metadata it sent. An upload response is a claim ("I asked for 24
         * Tamil tags"); a read-back is evidence ("YouTube is holding 24 tags
         * and defaultAudioLanguage: ta"). The four uploads that shipped broken
         * in July 2026 were all broken in exactly that gap.
         *
         * `processingDetails` is deliberately NOT added to the `part` list
         * above: that part is owner-authorized only and this call carries an
         * API key rather than OAuth, so asking for it would be dropped quietly
         * instead of failing loudly. The panel therefore infers the processing
         * window from what IS here — a `durationSeconds` of 0 or
         * `definition: 'sd'` on a fresh upload means YouTube has not finished
         * processing, NOT that a bad file was sent (see admin-docs, "read the
         * metadata back") — and offers a re-check rather than a verdict.
         */
        stored: {
          duration: item.contentDetails?.duration ?? null,
          durationSeconds,
          definition: item.contentDetails?.definition ?? null,
          privacyStatus: item.status?.privacyStatus ?? null,
          categoryId: snapshot.categoryId || null,
          tagCount: snapshot.tags.length,
          defaultLanguage: snapshot.defaultLanguage ?? null,
          defaultAudioLanguage: snapshot.defaultAudioLanguage ?? null,
          // The largest thumbnail YouTube is actually serving, by pixel area —
          // the picture itself, not a boolean claiming one exists.
          thumbnail: largestThumbnail(snippet.thumbnails),
          playlistIds,
        },
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
