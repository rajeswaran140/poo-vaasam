/**
 * /performers — gated "For Performers" portal (lyrics + backing tracks).
 *
 * Server layout so it can set `noindex` (the area is private to signed-in
 * performers and must never be indexed; robots.txt also disallows /performers).
 * The actual auth gate + chrome live in the client <PerformerGate>.
 */

import type { Metadata } from 'next';
import { PerformerGate } from '@/components/performers/PerformerGate';

export const metadata: Metadata = {
  title: 'For Performers · தமிழகவல்',
  description: 'Lyrics and backing tracks for performing Tamilagaval songs — for signed-in performers.',
  robots: { index: false, follow: false },
};

export default function PerformersLayout({ children }: { children: React.ReactNode }) {
  return <PerformerGate>{children}</PerformerGate>;
}
