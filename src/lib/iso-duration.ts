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
