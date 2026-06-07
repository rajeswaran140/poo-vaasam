/**
 * youtube-uploads — list a channel's uploads (id + title + ISO duration) via the
 * YouTube Data API. Shared by the publish flow (auto-link a song to its video +
 * read the video's duration) and any catalogue tooling.
 *
 * Returns [] without a YOUTUBE_API_KEY so callers degrade gracefully. The
 * channel's uploads live in the `UU…` playlist (UC… channel id with the prefix
 * swapped).
 */

export interface ChannelUpload {
  id: string;
  title: string;
  /** ISO-8601 (e.g. "PT4M14S"), attached best-effort from videos.list. */
  duration?: string;
}

const MAX_PAGES = 5; // 50/page → up to 250 uploads

function uploadsPlaylistId(channelId: string): string {
  return channelId.startsWith('UC') ? `UU${channelId.slice(2)}` : channelId;
}

export async function fetchChannelUploadsWithDurations(
  channelId: string
): Promise<ChannelUpload[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];

  const playlistId = uploadsPlaylistId(channelId);
  const uploads: ChannelUpload[] = [];
  let pageToken = '';

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50` +
      `&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(key)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    let json: { items?: unknown[]; nextPageToken?: string };
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      json = await res.json();
    } catch {
      break;
    }
    for (const raw of json.items ?? []) {
      const sn = (raw as { snippet?: Record<string, unknown> }).snippet ?? {};
      const id = (sn.resourceId as { videoId?: string })?.videoId;
      if (typeof id === 'string' && /^[\w-]{11}$/.test(id)) {
        uploads.push({ id, title: String(sn.title ?? '').trim() });
      }
    }
    pageToken = json.nextPageToken ?? '';
    if (!pageToken) break;
  }

  if (uploads.length > 0) {
    try {
      const ids = uploads.map((u) => u.id).join(',');
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${encodeURIComponent(key)}`
      );
      if (res.ok) {
        const json = (await res.json()) as {
          items?: { id?: string; contentDetails?: { duration?: string } }[];
        };
        const byId = new Map((json.items ?? []).map((v) => [v.id, v.contentDetails?.duration]));
        for (const u of uploads) {
          const d = byId.get(u.id);
          if (typeof d === 'string') u.duration = d;
        }
      }
    } catch {
      /* durations are best-effort */
    }
  }

  return uploads;
}
