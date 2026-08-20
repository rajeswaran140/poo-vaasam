/**
 * Admin — Twitch integration.
 *
 * Phase 1: connection health, channel, live/offline, EventSub status, last
 * event. The Now Playing / requests / voting surfaces are Phase 2 and are
 * deliberately absent rather than stubbed.
 */

import type { Metadata } from 'next';
import TwitchPanel from '@/components/admin/TwitchPanel';

export const metadata: Metadata = {
  title: 'Twitch · Admin',
};

export default function AdminTwitchPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Twitch</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Connect the Twitch channel, and watch stream status and EventSub health.
        </p>
      </div>
      <TwitchPanel />
    </div>
  );
}
