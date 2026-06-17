'use client';

/**
 * /performers (authed landing). Rendered by <PerformerGate> only once signed in.
 * Calls the gated `/api/performers/me` via `performerFetch` to (a) confirm the
 * session is genuinely valid server-side — not just a stale Amplify cookie —
 * and (b) greet the performer. Phase 2 replaces the "coming soon" panel with the
 * list of performable songs (gated lyrics + backing tracks).
 */

import { useEffect, useState } from 'react';
import { performerFetch } from '@/lib/client-auth';

export default function PerformersHome() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    performerFetch('/api/performers/me')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (active) setEmail(typeof d.email === 'string' ? d.email : null); })
      .catch((e) => { if (active) setError(e instanceof Error ? e.message : 'Failed to verify session'); });
    return () => { active = false; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-kavivanar text-3xl text-orange-800">வணக்கம், பாடகரே 🎤</h1>
        <p className="mt-1 font-tamil text-gray-600">
          {email ? `Signed in as ${email}.` : 'Welcome to the performers area.'}
        </p>
      </div>

      <div className="rounded-xl border border-orange-100 bg-orange-50/60 p-5">
        <h2 className="font-tamil text-lg font-semibold text-gray-800">விரைவில் · Coming soon</h2>
        <p className="mt-1 text-sm text-gray-600">
          Lyrics and karaoke backing tracks to learn and perform தமிழகவல் songs will appear here.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-500">Could not verify your session: {error}</p>
      )}
    </div>
  );
}
