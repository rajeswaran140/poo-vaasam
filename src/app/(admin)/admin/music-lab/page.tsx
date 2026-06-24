/**
 * /admin/music-lab — log & evaluate every generation against its brief, so
 * failed SUNO attempts become a research dataset (see the "Music Lab" direction
 * in project_poo_vaasam_composer). Thin server shell; all interaction lives in
 * the client <MusicLab>, which talks to /api/admin/{briefs,generations}.
 */

import { MusicLab } from '@/components/admin/MusicLab';

export const dynamic = 'force-dynamic';

export default function AdminMusicLabPage() {
  return <MusicLab />;
}
