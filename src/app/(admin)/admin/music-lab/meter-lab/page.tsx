/**
 * /admin/music-lab/meter-lab — Lyric Meter Lab.
 *
 * Client-only: the analysis is pure and runs in the browser, and the Lexicon
 * lookups go through adminFetch like every other admin surface. Nothing is read
 * server-side, so there is no DynamoDB round trip before first paint.
 */

import { LyricMeterLab } from '@/components/admin/music/LyricMeterLab';

export const metadata = { title: 'Lyric Meter Lab' };

export default function LyricMeterLabPage() {
  return <LyricMeterLab />;
}
