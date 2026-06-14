/**
 * Presentation helpers for video cards — duration badges (YouTube-style m:ss)
 * and relative upload dates in Tamil ("3 நாட்கள் முன்"). Pure + unit-tested so
 * the client components stay declarative.
 *
 * Relative time takes an explicit `now` so a server component can pass one
 * reference instant down to its client children — server and client then format
 * identically and there's no hydration mismatch.
 */

import { iso8601DurationToSeconds } from '@/lib/youtube-shorts';

/** Format an ISO-8601 duration as a YouTube-style badge: "m:ss" or "h:mm:ss". */
export function formatVideoDuration(iso: string | undefined): string | null {
  const total = iso8601DurationToSeconds(iso);
  if (total === null || total <= 0) return null;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const REL_UNITS: Array<{ secs: number; one: string; many: string }> = [
  { secs: 31_536_000, one: 'ஆண்டு', many: 'ஆண்டுகள்' },
  { secs: 2_592_000, one: 'மாதம்', many: 'மாதங்கள்' },
  { secs: 604_800, one: 'வாரம்', many: 'வாரங்கள்' },
  { secs: 86_400, one: 'நாள்', many: 'நாட்கள்' },
  { secs: 3_600, one: 'மணிநேரம்', many: 'மணிநேரம்' },
  { secs: 60, one: 'நிமிடம்', many: 'நிமிடங்கள்' },
];

/**
 * Relative upload time in Tamil. Sub-minute (or future-dated) collapses to
 * "இப்போது"; otherwise "{n} {unit} முன்" with singular/plural units.
 */
export function relativeTimeTamil(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'இப்போது';
  for (const u of REL_UNITS) {
    if (diff >= u.secs) {
      const n = Math.floor(diff / u.secs);
      return `${n} ${n === 1 ? u.one : u.many} முன்`;
    }
  }
  return 'இப்போது';
}
