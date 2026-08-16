/**
 * sync-song-themes-from-playlists — set each song's browse theme from the
 * YouTube playlist it actually sits in.
 *
 *   npx tsx scripts/sync-song-themes-from-playlists.ts            # dry run
 *   npx tsx scripts/sync-song-themes-from-playlists.ts --apply
 *   npx tsx scripts/sync-song-themes-from-playlists.ts --only a,b # limit to ids
 *
 * WHY. Theme resolves as DB override -> SONG_THEME_BY_ID -> DEFAULT_SONG_THEME
 * ('love'). That default was written when the catalogue was almost all love
 * songs and the config says it "never lies for unmapped tracks" — which stopped
 * being true the moment 35 synced pages landed carrying father, mother,
 * homeland and nature songs. An unmapped song does not look untagged; it looks
 * confidently wrong, and shows up under காதல் on /songs.
 *
 * So this writes an EXPLICIT override for every song it can classify, rather
 * than relying on a default that happens to be right for the majority.
 *
 * SOURCE OF TRUTH is playlist membership — an observable fact about the
 * channel, not an inference from Tamil wording. Songs in no theme playlist are
 * reported as UNCLASSIFIED and left alone: naming a song's theme from its
 * lyrics is Raj's call, not this script's.
 *
 * READ-ONLY on YouTube. The only write is `theme` on the song's METADATA item,
 * via the same setSongTheme() the admin UI uses.
 */
import { setSongTheme } from '../src/lib/song-theme-write';
import { ContentRepository } from '../src/infrastructure/database/ContentRepository';
import { ContentType } from '../src/types/content';
import { getYouTubeId } from '../src/lib/utils/youtube';
import { themeForSongWithOverride, SONG_THEME_BY_ID, type SongTheme } from '../src/config/song-themes';

/**
 * Theme playlists, MOST SPECIFIC FIRST — a song in both அப்பா and காதல் is a
 * father song. 'love' sits last because it is also the fallback, so it must
 * never win over a narrower lane.
 */
const THEME_PLAYLISTS: Array<{ id: string; theme: SongTheme; label: string }> = [
  { id: 'PLROeIeP9QTbE', theme: 'father', label: '👨 அப்பா Father' },
  { id: 'PLLsCQ9NH4rLSmoTAihKjyVGXV5coMTs8v', theme: 'mother', label: '👩 தாய் Mother & Family' },
  { id: 'PLBvE3gZuV2bs', theme: 'tamil', label: '🪶 பாரதியார் Bharathiyar' },
  { id: 'PLEXvbEQYvb5A', theme: 'homeland', label: '🌾 தாயகம் Heritage' },
  { id: 'PLd2XEXNc60_M', theme: 'nature', label: '🍃 இயற்கை & வாழ்வியல் Nature & Life' },
  { id: 'PLL_bTIv5Q1GU', theme: 'love', label: '💔 சோகக் காதல் Sad Love' },
  { id: 'PLLsCQ9NH4rLRQMADaAhuHN_VBTHpwZ-DW', theme: 'love', label: '❤️ காதல் Love' },
];

const API = 'https://www.googleapis.com/youtube/v3';

async function playlistVideoIds(playlistId: string, key: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = '';
  do {
    const res = await fetch(
      `${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlistId}&key=${key}&pageToken=${pageToken}`
    );
    if (!res.ok) throw new Error(`playlistItems ${playlistId}: ${res.status}`);
    const body = (await res.json()) as {
      items?: Array<{ contentDetails?: { videoId?: string } }>;
      nextPageToken?: string;
    };
    for (const item of body.items ?? []) {
      if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
    }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return ids;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const onlyArg = process.argv.includes('--only')
    ? process.argv[process.argv.indexOf('--only') + 1]
    : undefined;
  const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : undefined;

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is required');

  // videoId -> theme, first (most specific) playlist wins
  const themeByVideo = new Map<string, { theme: SongTheme; label: string }>();
  for (const pl of THEME_PLAYLISTS) {
    for (const videoId of await playlistVideoIds(pl.id, key)) {
      if (!themeByVideo.has(videoId)) themeByVideo.set(videoId, { theme: pl.theme, label: pl.label });
    }
  }
  console.log(`theme playlists: ${THEME_PLAYLISTS.length}, videos classified: ${themeByVideo.size}\n`);

  const repo = new ContentRepository();
  const songs: Array<{ id: string; title: string; videoId?: string; theme?: unknown }> = [];
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await repo.findByType(ContentType.SONGS, { limit: 100, lastEvaluatedKey: cursor });
    for (const c of page.items) {
      songs.push({
        id: c.id,
        title: c.title,
        videoId: c.youtubeVideoId || getYouTubeId(c.videoUrl) || undefined,
        theme: c.theme,
      });
    }
    cursor = page.lastEvaluatedKey as Record<string, unknown> | undefined;
  } while (cursor);

  const changes: Array<{ id: string; title: string; from: SongTheme | null; to: SongTheme; label: string }> = [];
  const unclassified: Array<{ id: string; title: string; resolved: SongTheme | null }> = [];
  const curatedConflicts: Array<{ id: string; title: string; curated: SongTheme; playlist: SongTheme; label: string }> = [];
  let alreadyCorrect = 0;

  for (const s of songs) {
    if (only && !only.has(s.id) && !(s.videoId && only.has(s.videoId))) continue;
    const resolved = themeForSongWithOverride(s.id, s.theme);
    const match = s.videoId ? themeByVideo.get(s.videoId) : undefined;
    if (!match) { unclassified.push({ id: s.id, title: s.title, resolved }); continue; }
    // Write an explicit override even when it equals the resolved value, unless
    // the row ALREADY carries that exact override — the point is to stop
    // depending on a default that is only accidentally right.
    if (s.theme === match.theme) { alreadyCorrect++; continue; }
    // NEVER silently overrule a hand-curated SONG_THEME_BY_ID entry. That map is
    // a human judgement about a song's meaning; playlist membership is only a
    // proxy for it, and a song can sit in அப்பா while really being about both
    // parents. Report the disagreement and let Raj settle it.
    const curated = SONG_THEME_BY_ID[s.id];
    if (curated && curated !== match.theme) {
      curatedConflicts.push({ id: s.id, title: s.title, curated, playlist: match.theme, label: match.label });
      continue;
    }
    changes.push({ id: s.id, title: s.title, from: resolved, to: match.theme, label: match.label });
  }

  const moved = changes.filter((c) => c.from !== c.to);
  console.log(`songs examined      : ${songs.length}`);
  console.log(`already pinned      : ${alreadyCorrect}`);
  console.log(`to write            : ${changes.length}  (of which ${moved.length} CHANGE the visible theme)`);
  console.log(`unclassified        : ${unclassified.length}  (in no theme playlist — left alone)\n`);

  if (moved.length) {
    console.log('--- visible theme changes ---');
    for (const c of moved) console.log(`  ${(c.from ?? '(none)').padEnd(10)} -> ${c.to.padEnd(10)} ${c.title.slice(0, 44)}   [${c.label}]`);
  }
  if (unclassified.length) {
    console.log('\n--- UNCLASSIFIED (no theme at all; needs Raj) ---');
    for (const u of unclassified) console.log(`  ${(u.resolved ?? '(none)').padEnd(10)} ${u.id}  ${u.title.slice(0, 50)}`);
  }
  if (curatedConflicts.length) {
    console.log('\n--- CURATED vs PLAYLIST disagreement (NOT written; needs Raj) ---');
    for (const c of curatedConflicts) {
      console.log(`  curated=${c.curated.padEnd(9)} playlist=${c.playlist.padEnd(9)} ${c.title.slice(0, 40)}   [${c.label}]`);
    }
  }

  if (!apply) { console.log('\ndry run — re-run with --apply to write'); return; }

  let ok = 0; const failed: string[] = [];
  for (const c of changes) {
    try { await setSongTheme(c.id, c.to); ok++; } catch (err) { failed.push(c.id); console.error(`  FAIL ${c.id}`, err); }
  }
  console.log(`\nwrote ${ok} theme override(s), ${failed.length} failed`);
  if (ok) console.log('⚠️  /songs is build-time data — the chips change only after the next Amplify redeploy.');
}

main().catch((err) => { console.error(err); process.exit(1); });
