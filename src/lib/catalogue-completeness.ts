/**
 * CATALOGUE COMPLETENESS — does the website actually show the catalogue?
 *
 * ⚠️ WHY THIS EXISTS. On 2026-08-16 `/songs` was serving **16 of 55 published
 * songs**, and had been for weeks. Nothing noticed: not a test, not a cron, not
 * a dashboard. Every daily cron watches YouTube; none watched the WEBSITE
 * against YouTube. The songs were in DynamoDB, marked PUBLISHED, and silently
 * discarded by a projection rule that required an `audioUrl` the YouTube sync
 * deliberately never sets.
 *
 * Fixing that instance without fixing the blindness invites the next one, so
 * this measures the two gaps that can hide a song, and keeps them SEPARATE
 * because they have completely different causes and remedies:
 *
 *   INGESTION gap  — on YouTube, no record on the site.
 *                    Remedy: /admin/content → "Sync songs from YouTube".
 *
 *   VISIBILITY gap — a record exists and is PUBLISHED, but the public
 *                    projection drops it, so no page and no listing.
 *                    Remedy: a CODE fix. This is the one that hid 37 songs,
 *                    and the one no human would ever spot by browsing, because
 *                    the admin list looks complete.
 *
 * Pure and deterministic: callers fetch, this compares. No I/O, no clock.
 */

/** A song as published on the channel. */
export interface ChannelSong {
  videoId: string;
  title: string;
  views: number;
}

/** A content record as stored, before the public projection runs. */
export interface StoredSong {
  id: string;
  title: string;
  youtubeVideoId?: string | null;
  /** PUBLISHED / DRAFT / … — only published records are expected to be public. */
  status: string;
}

/** A song as the PUBLIC surface actually emits it (post-projection). */
export interface VisibleSong {
  id: string;
}

export interface CompletenessGap {
  videoId?: string;
  id?: string;
  title: string;
  views?: number;
  /**
   * Set when an unsynced channel song's title matches a song ALREADY on the
   * site — almost certainly a re-recording, not a missing song.
   *
   * ⚠️ Raj publishes improved lyrics as a NEW upload and never unlists the
   * original, so the channel legitimately holds several near-duplicate titles
   * (செவ்வந்தி பூவே appears twice, at 35,542 and 2,123 views). Syncing those
   * blindly creates a second page for the same song and splits its traffic.
   * This does not exclude them — it marks them for a human decision.
   */
  likelyRevisionOf?: { id: string; title: string };
}

/**
 * Title reduced to a comparable key: no emoji, no punctuation, no case.
 *
 * ⚠️ For a BILINGUAL title the identity is the TAMIL HOOK ALONE. Raj's titles
 * carry a romanization after the Tamil, but the separator is inconsistent —
 * "ஈழத்து மண்ணே | Eelathu Manne" uses a pipe, "நீ சிரிச்ச நேரம் தான் 🎋 Nee
 * Sirichcha Neram Thaan" uses only a space. Splitting on the pipe alone kept
 * the English half in one key and dropped it from the other, so a song failed
 * to match its own re-recording. Cutting at the first Latin letter is stable
 * across both forms.
 */
function titleKey(raw: string): string {
  const beforePipe = raw.split(/[|｜]/)[0] ?? raw;
  // Tamil-script prefix, if there is one. English-titled songs (Maple Breeze)
  // have none, so they keep the full string rather than collapsing to ''.
  const tamilPrefix = beforePipe.split(/[A-Za-z]/)[0] ?? '';
  const base = /[\u0B80-\u0BFF]/.test(tamilPrefix) ? tamilPrefix : beforePipe;

  return (
    base
      // ⚠️ NFC FIRST. Tamil vowel signs can arrive composed or decomposed
      // depending on where the title was typed, and two byte-different strings
      // then render identically. Without this, நீ சிரிச்ச நேரம் தான் failed to
      // match its own re-recording and was reported as a missing song.
      .normalize('NFC')
      // Zero-width joiners/non-joiners and directional marks are invisible and
      // inconsistently present in pasted titles.
      .replace(/[\u200B-\u200F\uFEFF]/gu, '')
  )
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    // Trailing ellipses and stray dots vary between uploads of the same song
    // ("செவ்வந்தி பூவே... சிரிக்கும் நிலவே..." vs "...நிலவே. . ."), so they
    // cannot be part of the identity.
    .replace(/[.…]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface CompletenessReport {
  channelSongs: number;
  storedPublished: number;
  publiclyVisible: number;

  /** On the channel, no record on the site. Fix by syncing. */
  ingestionGap: CompletenessGap[];
  /** PUBLISHED in the database, dropped by the public projection. Fix in CODE. */
  visibilityGap: CompletenessGap[];

  /** Views sitting behind the ingestion gap, and its share of the catalogue. */
  ingestionGapViews: number;
  ingestionGapShare: number;

  /** True when every published record reaches the public surface. */
  healthy: boolean;
}

/**
 * Compare the three views of the catalogue.
 *
 * `visible` must be the output of the SAME projection the public pages use
 * (SongCatalog → listableSongs), not a re-derivation — the point is to catch
 * that projection dropping records, so re-implementing its rules here would
 * reproduce the bug rather than detect it.
 */
export function assessCatalogue(
  channel: readonly ChannelSong[],
  stored: readonly StoredSong[],
  visible: readonly VisibleSong[]
): CompletenessReport {
  const storedVideoIds = new Set(
    stored.map((s) => (s.youtubeVideoId ?? '').trim()).filter(Boolean)
  );

  const storedByTitle = new Map<string, StoredSong>();
  for (const s of stored) {
    const k = titleKey(s.title);
    if (k && !storedByTitle.has(k)) storedByTitle.set(k, s);
  }

  const ingestionGap = channel
    .filter((c) => !storedVideoIds.has(c.videoId))
    .sort((a, b) => b.views - a.views)
    .map((c) => {
      const match = storedByTitle.get(titleKey(c.title));
      return {
        videoId: c.videoId,
        title: c.title,
        views: c.views,
        ...(match ? { likelyRevisionOf: { id: match.id, title: match.title } } : {}),
      };
    });

  const published = stored.filter((s) => s.status === 'PUBLISHED');
  const visibleIds = new Set(visible.map((v) => v.id));
  const visibilityGap = published
    .filter((s) => !visibleIds.has(s.id))
    .map((s) => ({ id: s.id, title: s.title }));

  const totalViews = channel.reduce((n, c) => n + c.views, 0);
  const gapViews = ingestionGap.reduce((n, c) => n + (c.views ?? 0), 0);

  return {
    channelSongs: channel.length,
    storedPublished: published.length,
    publiclyVisible: visible.length,
    ingestionGap,
    visibilityGap,
    ingestionGapViews: gapViews,
    // Views are the honest weighting: 9 unsynced songs matter far less than 9
    // that carry a third of the channel's traffic.
    ingestionGapShare: totalViews > 0 ? gapViews / totalViews : 0,
    // ⚠️ Health is judged on VISIBILITY only. An ingestion gap is normal — Raj
    // syncs deliberately, and a song published an hour ago has no page yet.
    // A published record that cannot be seen is never normal.
    healthy: visibilityGap.length === 0,
  };
}

/** One-line summary for a cron to print. */
export function summariseCatalogue(r: CompletenessReport): string {
  const parts = [
    `${r.publiclyVisible}/${r.storedPublished} published songs visible`,
    `${r.ingestionGap.length} not yet synced (${(r.ingestionGapShare * 100).toFixed(1)}% of views)`,
  ];
  if (!r.healthy) {
    parts.unshift(`⚠️ ${r.visibilityGap.length} PUBLISHED but INVISIBLE — this is a code fault, not a sync gap`);
  }
  return parts.join(' · ');
}
