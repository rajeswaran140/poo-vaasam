/**
 * /admin/music-lab/studio-test — Composition Studio Phase 0, the blind
 * listening test of shippable instrument samples against Suno stems.
 * Thin shell; everything happens in the client <StudioPhase0>. Not in the
 * sidebar: Raj opens it from the link in the PR. Throwaway, removed by the
 * Phase 0 cleanup PR.
 */
import { StudioPhase0 } from '@/components/admin/music/StudioPhase0';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Studio listening test' };

export default function StudioListeningTestPage() {
  return <StudioPhase0 />;
}
