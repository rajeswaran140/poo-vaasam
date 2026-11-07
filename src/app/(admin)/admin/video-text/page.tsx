/**
 * /admin/video-text — add a title, lyrics and credits to a finished song
 * video. Thin server shell; everything interactive is in <VideoTextApp>.
 */
import type { Metadata } from 'next';
import { VideoTextApp } from '@/components/admin/video-text/VideoTextApp';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Video Text — Tamilagaval' };

export default function AdminVideoTextPage() {
  return <VideoTextApp />;
}
