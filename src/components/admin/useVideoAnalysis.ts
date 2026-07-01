'use client';

/**
 * Shared state machine for the per-video insight panels (retention, geography).
 *
 * Handles the two subtle correctness bugs both panels otherwise share:
 *   1. Changing the selected video clears the previously-shown card + error, so
 *      a stale result can never be read under a new video's label.
 *   2. A monotonic request id ignores out-of-order responses (rapid re-clicks),
 *      so a slow earlier response can't overwrite a newer one.
 *
 * The panel supplies the video list and a `buildUrl(videoId)` mapper; the fetch
 * goes through adminFetch (Cognito Bearer auth).
 */

import { useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';

export interface UseVideoAnalysis<T> {
  videoId: string;
  setVideoId: (id: string) => void;
  loading: boolean;
  error: string | null;
  result: T | null;
  analyze: () => Promise<void>;
}

export function useVideoAnalysis<T>(
  videos: Array<{ id: string }>,
  buildUrl: (videoId: string) => string
): UseVideoAnalysis<T> {
  const [videoId, setVideoIdState] = useState(videos[0]?.id ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const reqId = useRef(0);

  function setVideoId(id: string) {
    reqId.current++; // invalidate any in-flight request for the old selection
    setVideoIdState(id);
    setResult(null);
    setError(null);
    setLoading(false);
  }

  async function analyze() {
    if (!videoId) return;
    const myReq = ++reqId.current;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await adminFetch(buildUrl(videoId));
      const json = await res.json();
      if (myReq !== reqId.current) return; // superseded by a newer request/selection
      if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status})`);
      setResult(json as T);
    } catch (err) {
      if (myReq === reqId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }

  return { videoId, setVideoId, loading, error, result, analyze };
}
