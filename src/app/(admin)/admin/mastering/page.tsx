/**
 * /admin/mastering — the Sound Engineering & Mastering module. Thin server
 * shell; all interaction lives in the client <MasteringStudio>, which talks to
 * /api/admin/mastering/{upload,download} and the existing async master job
 * (/api/admin/music-lab/master).
 */

import { MasteringStudio } from '@/components/admin/MasteringStudio';

export const dynamic = 'force-dynamic';

export default function AdminMasteringPage() {
  return <MasteringStudio />;
}
