/**
 * /admin/release — thin server shell; the interaction lives in the client
 * <ReleaseChecker>, which calls /api/admin/youtube/release-check.
 */

import { ReleaseChecker } from '@/components/admin/ReleaseChecker';

export const dynamic = 'force-dynamic';

export default function AdminReleasePage() {
  return <ReleaseChecker />;
}
