/**
 * Seconds → ISO-8601 duration string (e.g. 185 → "PT3M5S", 336 → "PT5M36S") for
 * schema.org `duration` fields. Shared by the /songs playlist JSON-LD and the
 * per-song page's MusicComposition so they can't disagree.
 */
export function isoDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `PT${m}M${s}S`;
}

/**
 * ISO-8601 duration string → whole seconds (the inverse of isoDuration, but also
 * handles the hour component YouTube emits, e.g. "PT1H2M3S"). Used by the video
 * sitemap, whose `<video:duration>` field wants seconds. Returns 0 for anything
 * it can't parse, so callers can guard on `> 0`.
 */
export function isoDurationToSeconds(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec((iso ?? '').trim());
  // No match, or "PT" with no H/M/S component → unparseable.
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  const [h, min, s] = [m[1], m[2], m[3]].map((x) => parseInt(x ?? '0', 10) || 0);
  return h * 3600 + min * 60 + s;
}
