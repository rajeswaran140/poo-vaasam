/**
 * Release checklist — what a Tamilagaval upload needs before it is "done".
 *
 * Every rule here exists because a REAL release shipped without it. Between
 * 2026-07-28 and 2026-07-30, four uploads went out and each was missing
 * something different: the duet had `defaultAudioLanguage: en-US` on a Tamil
 * song, two Shorts had no romanized title, one teaser named its premiere but
 * never linked to it, one carried a heading with no section under it, and one
 * was serving YouTube's English auto-transcription of sung Tamil. None of those
 * is hard to spot — they are hard to spot *every time*, by hand, at upload.
 *
 * Pure and I/O-free: the caller fetches the video's state, this decides what is
 * wrong. That keeps every rule unit-testable against a fixture instead of a
 * live channel, and means the same rules can drive a UI, a cron, or a report.
 *
 * The checklist deliberately does NOT judge content — no opinions on duration,
 * theme, or wording. Raj has ruled duration out of scope, and the Tamil is his.
 * These are mechanical, verifiable facts about metadata.
 */

import { COMPOSITION_CTA, hasCompositionCta } from '@/lib/commission';

/** Everything the checklist needs to know about one upload. */
export interface VideoSnapshot {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  hasCustomThumbnail: boolean;
  /** True when the upload is a Short (drives which rules apply). */
  isShort: boolean;
  /** Playlist ids this video belongs to. */
  playlistIds: string[];
  captionTracks: Array<{ trackKind: string; language: string }>;
  /** Null when the video is an upcoming premiere that has not aired. */
  isUpcoming?: boolean;
}

export type Severity = 'blocker' | 'gap' | 'note';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Concrete replacement text, when one can be generated. */
  fix?: string;
  /** True when no API can apply it — Studio-only. */
  manual?: boolean;
}

export const MUSIC_CATEGORY_ID = '10';
export const SHORTS_PLAYLIST_ID = 'PLLsCQ9NH4rLQceNHkbO4_4FCerVT4oOKt';
export const ALL_SONGS_PLAYLIST_ID = 'PLLsCQ9NH4rLSZU0Ycy6I-Xr8DMAbe4vjs';
export const LATEST_PLAYLIST_ID = 'PLLsCQ9NH4rLQAr8WLqKSZu6JNd-9ns-wU';
export const SITE_URL_UTM = 'https://tamilagaval.com/?utm_source=youtube&utm_medium=description';
export const SUBSCRIBE_URL = 'https://www.youtube.com/@Tamilagaval?sub_confirmation=1';

/** Minimum tags before the upload counts as tagged at all. */
export const MIN_TAGS = 10;

/**
 * The retired full name. Raj publishes as "Raj" / "Raj Thangarajah"; the older
 * "Rajeswaran Thangarajah" is not to appear anywhere in public metadata.
 *
 * Matching the FIRST NAME alone is deliberate. The 2026-07-18 catalogue sweep
 * checked only the © credit line and reported clean; on 2026-07-31 the name was
 * still on 23 of 90 videos — 21 as a `Rajeswaran Thangarajah` tag and 3 as a
 * `#RajeswaranThangarajah` hashtag, forms a credit-line check never looked at
 * and a two-word pattern would miss across the hashtag's missing space. One
 * of the 23 was the channel's biggest upload at 47k views.
 */
export const RETIRED_NAME = /rajeswaran/i;

const has = (s: string, re: RegExp) => re.test(s);

/**
 * Does the title carry a romanized form?
 *
 * The convention is Tamil hook + ROMANIZED + English descriptor, because
 * diaspora viewers search romanized ("Ezhudhaadha Variyile"), not Tamil script.
 * Detecting it is fuzzy: an English descriptor like "Tamil Duet Love Song" is
 * also Latin text. The signal we use is a Latin run that is NOT part of the
 * common descriptor vocabulary — i.e. a transliterated word.
 */
const DESCRIPTOR_WORDS = new Set([
  'tamil','song','songs','love','duet','melody','music','lyrics','original','romantic',
  'video','shorts','short','folk','village','sad','emotional','mother','father','family',
  'heritage','instrumental','flute','new','official','full','tamilagaval','feat','ft',
  'english','cover','live','audio','hd','4k',
]);

export function hasRomanizedTitle(title: string): boolean {
  const latinRuns = title.match(/[A-Za-z][A-Za-z'’-]{2,}/g) ?? [];
  return latinRuns.some((w) => !DESCRIPTOR_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, '')));
}

/** Run every rule. Ordered most-severe first. */
export function checkRelease(v: VideoSnapshot): Finding[] {
  const f: Finding[] = [];
  const d = v.description ?? '';

  // --- metadata that changes who YouTube shows this to ---------------------
  if ((v.defaultAudioLanguage ?? '').toLowerCase() !== 'ta') {
    f.push({
      id: 'audio-language',
      severity: 'blocker',
      title: 'defaultAudioLanguage is not "ta"',
      detail:
        `Currently ${v.defaultAudioLanguage ? `"${v.defaultAudioLanguage}"` : 'unset'}. This drives language ` +
        `targeting and who the song is recommended to. The duet shipped as "en-US" on 2026-07-29 — a Tamil ` +
        `song told YouTube it was English.`,
      fix: 'ta',
    });
  }
  if (v.categoryId !== MUSIC_CATEGORY_ID) {
    f.push({
      id: 'category',
      severity: 'blocker',
      title: 'Category is not Music',
      detail: `categoryId is "${v.categoryId}", expected "${MUSIC_CATEGORY_ID}" (Music).`,
      fix: MUSIC_CATEGORY_ID,
    });
  }

  // --- captions -------------------------------------------------------------
  // An UNAIRED premiere has no captions yet — YouTube generates ASR only after
  // it airs. Judging it now produces a finding the operator cannot act on, and
  // which fixes itself. `I0F7xHxg7cI` sat in this state on 2026-07-30 (its
  // contentDetails.duration was even null).
  const asr = v.isUpcoming ? [] : v.captionTracks.filter((t) => t.trackKind === 'asr');
  if (v.isUpcoming) {
    f.push({
      id: 'upcoming-premiere',
      severity: 'note',
      title: 'Unaired premiere — caption checks skipped',
      detail: 'Captions do not exist until a premiere airs. Re-run this check afterwards.',
    });
  }
  const wrongLangAsr = asr.filter((t) => t.language !== 'ta');
  if (wrongLangAsr.length) {
    f.push({
      id: 'asr-wrong-language',
      severity: 'blocker',
      title: `Auto-caption in the wrong language (${wrongLangAsr.map((t) => t.language).join(', ')})`,
      detail:
        'YouTube transcribed sung Tamil as another language, which produces nonsense on screen. ' +
        '16 of these were found across the catalogue on 2026-07-29, including on top performers.',
    });
  } else if (asr.length) {
    f.push({
      id: 'asr-track',
      severity: 'gap',
      title: 'Serving an auto-generated caption track',
      detail:
        'Machine transcription of sung Tamil. The standing convention is to keep only uploaded lyric tracks.',
    });
  }

  // --- title ----------------------------------------------------------------
  if (!hasRomanizedTitle(v.title)) {
    f.push({
      id: 'title-romanized',
      severity: 'gap',
      title: 'Title has no romanized form',
      detail:
        'Diaspora viewers search romanized text, not Tamil script. Two Shorts shipped without it this week.',
    });
  }

  // --- description ----------------------------------------------------------
  if (!has(d, /sub_confirmation=1/)) {
    f.push({
      id: 'subscribe-link',
      severity: 'gap',
      title: 'No subscribe link with sub_confirmation=1',
      detail: 'The confirmation parameter is what makes the subscribe prompt appear.',
      fix: `🔔 Subscribe: ${SUBSCRIBE_URL}`,
    });
  }
  if (!has(d, /utm_source=youtube/)) {
    f.push({
      id: 'utm-site-link',
      severity: 'gap',
      title: 'Site link is not UTM-tagged',
      detail: 'Without it, traffic from this video is indistinguishable from any other referral.',
      fix: `🌐 ${SITE_URL_UTM}`,
    });
  }
  if (!has(d, /playlist\?list=/)) {
    f.push({
      id: 'playlist-links',
      severity: 'gap',
      title: 'No playlist links in the description',
      detail: 'Playlist traffic is the second-largest source on this channel after suggested.',
      fix: `▶️ அனைத்து பாடல்கள் | All Songs: https://www.youtube.com/playlist?list=${ALL_SONGS_PLAYLIST_ID}`,
    });
  }
  // Advisory, not a gap: the service link is a judgement call per song, and a
  // note keeps it visible in the sweep without ever reading as a defect.
  if (!hasCompositionCta(d)) {
    f.push({
      id: 'composition-cta',
      severity: 'note',
      title: 'No link to the music-composition service',
      detail:
        'The service page has produced zero commissions on 83 pageviews in 90 days — it is a reach problem, and descriptions are the only channel at scale.',
      fix: COMPOSITION_CTA,
    });
  }
  if (!has(d, /#[A-Za-z஀-௿]/)) {
    f.push({
      id: 'hashtags',
      severity: 'gap',
      title: 'No hashtags in the description',
      detail: 'Part of the standing per-upload checklist.',
    });
  }
  if (!has(d, /Lyrics\s*:/i)) {
    f.push({
      id: 'credits',
      severity: 'gap',
      title: 'No lyrics credit',
      detail: 'Raj wrote the lyrics; the credit line is also the legal anchor for the catalogue.',
      fix: '✍️ Lyrics: Raj (original, all rights reserved)',
    });
  }
  // A Short exists to send people to the full song. Without that link it is
  // just a clip — the teaser on 2026-07-28 named its premiere and never linked it.
  if (v.isShort && !has(d, /youtu\.be\/|watch\?v=/)) {
    f.push({
      id: 'short-full-song-link',
      severity: 'blocker',
      title: 'Short does not link to the full song',
      detail:
        'A Short with no link is a dead end. Its whole job is routing the viewer to the full upload.',
    });
  }
  // A heading with nothing under it looks unfinished to a viewer.
  const dangling = d.match(/^[^\n]*About Tamilagaval[^\n]*$\n\s*$/m);
  if (dangling) {
    f.push({
      id: 'empty-section',
      severity: 'note',
      title: 'Description has a heading with no content under it',
      detail: 'Reads as unfinished.',
    });
  }

  // --- tags, thumbnail, playlists ------------------------------------------
  if (v.tags.length < MIN_TAGS) {
    f.push({
      id: 'tags',
      severity: 'gap',
      title: `Only ${v.tags.length} tags`,
      detail: `Recent uploads carry 20-26. Below ${MIN_TAGS} suggests the field was skipped.`,
    });
  }
  // NOT a `hasCustomThumbnail` check any more. `thumbnails.maxres` was the
  // proxy, and measuring it across the catalogue on 2026-07-30 returned 90/90 —
  // YouTube auto-generates maxres for any HD upload, so the field says nothing
  // about whether Raj set a custom image. A rule that can never fire is worse
  // than none: it reports "thumbnail fine" without having looked.
  if (!v.isShort) {
    f.push({
      id: 'thumbnail',
      severity: 'note',
      title: 'Custom thumbnail cannot be verified via the API',
      detail:
        'thumbnails.maxres is present on 100% of the catalogue because YouTube generates it for HD ' +
        'uploads, so it cannot distinguish a custom image from an auto-grab. Confirm in Studio. ' +
        'The packaging study found the channel gap is a human-emotion face.',
      manual: true,
    });
  }
  const wantPlaylist = v.isShort ? SHORTS_PLAYLIST_ID : ALL_SONGS_PLAYLIST_ID;
  if (!v.playlistIds.includes(wantPlaylist)) {
    f.push({
      id: 'playlist-membership',
      severity: 'gap',
      title: v.isShort ? 'Not in the Shorts playlist' : 'Not in the All Songs playlist',
      detail: `Expected membership in ${wantPlaylist}.`,
    });
  }
  if (!v.isShort && !v.playlistIds.includes(LATEST_PLAYLIST_ID)) {
    f.push({
      id: 'latest-playlist',
      severity: 'note',
      title: 'Not in the Latest playlist',
      detail: 'New songs normally go here so returning viewers find them.',
    });
  }

  // --- retired name ---------------------------------------------------------
  // Checked across every field rather than the credit line, because that is
  // exactly the assumption that let this drift unnoticed for two weeks.
  const nameFields: Array<[string, string]> = [
    ['title', v.title],
    ['description', d],
    ...v.tags.map((t) => ['tag', t] as [string, string]),
  ];
  const offending = nameFields.filter(([, value]) => RETIRED_NAME.test(value ?? ''));
  if (offending.length) {
    const where = [...new Set(offending.map(([field]) => field))].join(', ');
    f.push({
      id: 'retired-name',
      severity: 'gap',
      title: 'Retired full name present in metadata',
      detail:
        `Found in: ${where}. Raj publishes as "Raj" or "Raj Thangarajah" — the older full name should ` +
        'not appear in public metadata. Swap rather than delete, so the credit and its search value survive.',
      fix: 'Raj Thangarajah',
    });
  }

  // --- things no API can check ---------------------------------------------
  f.push({
    id: 'pinned-comment',
    severity: 'note',
    title: 'Pinned comment cannot be verified',
    detail:
      'YouTube exposes no pinned-comment field and no pinning API. Confirm in Studio — it is on the checklist.',
    manual: true,
  });

  const order: Record<Severity, number> = { blocker: 0, gap: 1, note: 2 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}

export interface ReleaseSummary {
  videoId: string;
  blockers: number;
  gaps: number;
  notes: number;
  /** True when nothing mechanical is outstanding (notes may remain). */
  ready: boolean;
  findings: Finding[];
}

export function summariseRelease(v: VideoSnapshot): ReleaseSummary {
  const findings = checkRelease(v);
  const count = (s: Severity) => findings.filter((x) => x.severity === s).length;
  return {
    videoId: v.videoId,
    blockers: count('blocker'),
    gaps: count('gap'),
    notes: count('note'),
    ready: count('blocker') === 0 && count('gap') === 0,
    findings,
  };
}
