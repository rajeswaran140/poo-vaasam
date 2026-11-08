/**
 * /admin/video-text — add a title, lyrics and credits to a finished song
 * video. Thin server shell; everything interactive is in <VideoTextApp>.
 */
import type { Metadata } from 'next';
import { VideoTextApp } from '@/components/admin/video-text/VideoTextApp';
import { VIDEO_TEXT_FONT_VARS } from '@/components/admin/video-text/fontFaces';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Video Text — Tamilagaval' };

export default function AdminVideoTextPage() {
  // The wrapper defines the font variables the editor draws with (fontFaces.ts).
  return (
    <div className={VIDEO_TEXT_FONT_VARS} data-vt-fonts="">
      <VideoTextApp />
    </div>
  );
}
