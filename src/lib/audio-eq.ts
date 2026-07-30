/**
 * Monitoring equaliser for the mastering library player.
 *
 * ⚠️ READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * The mastering module's entire promise is "loudness only, never tone" — a
 * static gain change that leaves LRA untouched, which is the evidence nothing
 * was compressed or EQ'd. There is a standing decision that dynamics and tone
 * live UPSTREAM, at take selection, and that the worker applies no EQ.
 *
 * This equaliser does NOT contradict that, because it never touches the file.
 * It shapes PLAYBACK ONLY, in the browser, so Raj can audition a master on
 * different imagined systems. Nothing is written, uploaded or re-encoded.
 *
 * That distinction is only safe if the UI makes it impossible to confuse the
 * two, which is why:
 *   - the default is FLAT, so the first thing heard is always the real master;
 *   - `isFlat` exists so the player can warn, loudly, whenever what you are
 *     hearing is NOT what the file contains.
 * Remove either and this becomes a way to fool yourself about your own master.
 *
 * Pure and DOM-free: the band maths is unit-tested without an AudioContext.
 */

export interface EqBand {
  /** Stable id, also the React key and the aria-label stem. */
  id: string;
  /** Centre frequency in Hz. */
  frequency: number;
  /** Human label for the control. */
  label: string;
  /** Q for the peaking filter; wider at the extremes, tighter in the middle. */
  q: number;
}

/**
 * Five bands, chosen to be diagnostically useful rather than musical: enough to
 * hear whether a master is boomy, boxy, harsh or dull, without pretending to be
 * a mixing console.
 */
export const EQ_BANDS: readonly EqBand[] = [
  { id: 'low', frequency: 60, label: 'Low 60 Hz', q: 0.7 },
  { id: 'lowMid', frequency: 250, label: 'Low-mid 250 Hz', q: 1.0 },
  { id: 'mid', frequency: 1000, label: 'Mid 1 kHz', q: 1.0 },
  { id: 'highMid', frequency: 4000, label: 'High-mid 4 kHz', q: 1.0 },
  { id: 'high', frequency: 12000, label: 'High 12 kHz', q: 0.7 },
] as const;

/** Deliberately modest: this is for hearing a problem, not fixing one. */
export const EQ_MAX_GAIN_DB = 12;
export const EQ_MIN_GAIN_DB = -12;

export type EqGains = Record<string, number>;

/** All bands at 0 dB — the only state in which you are hearing the real file. */
export function flatGains(): EqGains {
  return Object.fromEntries(EQ_BANDS.map((b) => [b.id, 0]));
}

/** Clamp to the usable range, and treat nonsense as 0 rather than propagating NaN. */
export function clampGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(EQ_MAX_GAIN_DB, Math.max(EQ_MIN_GAIN_DB, db));
}

/**
 * Is playback unmodified?
 *
 * A tolerance would be wrong here. This drives the "you are not hearing the
 * master" warning, and a band nudged by 0.4 dB still means the audio has been
 * altered — the warning must not be suppressible by being subtle.
 */
export function isFlat(gains: EqGains): boolean {
  return EQ_BANDS.every((b) => (gains[b.id] ?? 0) === 0);
}

/** Bands currently doing something, for the warning line. */
export function activeBands(gains: EqGains): EqBand[] {
  return EQ_BANDS.filter((b) => (gains[b.id] ?? 0) !== 0);
}

/**
 * Plain-language summary of what the EQ is doing, e.g.
 * "Low 60 Hz +3 dB, High 12 kHz −2 dB".
 */
export function describeEq(gains: EqGains): string {
  const parts = activeBands(gains).map((b) => {
    const g = clampGain(gains[b.id] ?? 0);
    // U+2212 minus, not a hyphen — it reads correctly next to the + case.
    return `${b.label} ${g > 0 ? '+' : '−'}${Math.abs(g)} dB`;
  });
  return parts.join(', ');
}

/**
 * Reference curves. NOT corrective presets — each one imitates a playback
 * system so a master can be checked for a specific failure, which is why they
 * are named after the check rather than after a genre.
 */
export const EQ_PRESETS: ReadonlyArray<{ id: string; label: string; hint: string; gains: EqGains }> = [
  { id: 'flat', label: 'Flat', hint: 'The master as delivered', gains: flatGains() },
  {
    id: 'phone',
    label: 'Phone speaker',
    hint: 'No low end — does the song still hold up?',
    gains: { ...flatGains(), low: -12, lowMid: -6, mid: 3 },
  },
  {
    id: 'earbuds',
    label: 'Earbuds',
    hint: 'Hyped bass and treble, the most common listen',
    gains: { ...flatGains(), low: 5, high: 4 },
  },
  {
    id: 'harshness',
    label: 'Harshness check',
    hint: 'Lifts 4 kHz, where sibilance and strain show first',
    gains: { ...flatGains(), highMid: 8 },
  },
] as const;
