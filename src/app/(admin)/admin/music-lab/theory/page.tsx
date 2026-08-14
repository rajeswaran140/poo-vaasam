/**
 * /admin/music-lab/theory — Music Composition & Theory.
 *
 * Phase 1 surface: the two interactive tools (metronome, keyboard) plus the
 * Foundations and Rhythm lesson text. The Lyric Meter Lab and Composition
 * Notebook land next and get their own routes under this one.
 *
 * Static — no DynamoDB read, so it renders instantly and needs no auth round
 * trip beyond the admin layout's own gate.
 */

import { MusicTheoryWorkspace } from '@/components/admin/music/MusicTheoryWorkspace';

export const metadata = { title: 'Music Composition & Theory' };

export default function MusicTheoryPage() {
  return <MusicTheoryWorkspace />;
}
