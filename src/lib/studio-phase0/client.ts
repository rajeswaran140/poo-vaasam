/**
 * Browser-side calls for the listening-test page. Every one goes through an
 * existing admin route except the results route (Phase 0's only new one).
 */
import { adminFetch } from '@/lib/client-auth';
import type { Results } from './model';
import type { FetchKey } from './engine';

async function playUrl(key: string): Promise<string> {
  const res = await adminFetch(`/api/admin/mastering/download?mode=play&key=${encodeURIComponent(key)}`);
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.error || `Could not open ${key.split('/').pop()}.`);
  return body.url as string;
}

/** A private workspace file's bytes, through a short-lived presigned URL. */
export const fetchKey: FetchKey = async (key) => {
  const res = await fetch(await playUrl(key));
  if (!res.ok) throw new Error(`Could not download ${key.split('/').pop()} (HTTP ${res.status}).`);
  return res.arrayBuffer();
};

export async function fetchJson(key: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await fetchKey(key)));
}

/** Integrated loudness (LUFS) via the existing measure-fn route. */
export async function measureLufs(key: string): Promise<number> {
  const res = await adminFetch('/api/admin/music-lab/measure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ s3Key: key }),
  });
  const body = await res.json();
  const lufs = body?.metrics?.lufs;
  if (!res.ok || !body.success || typeof lufs !== 'number') throw new Error(body?.error || 'Measurement failed.');
  return lufs;
}

const RESULTS_URL = '/api/admin/music-lab/studio-phase0/results';

export async function loadResults(): Promise<Results | null> {
  const res = await adminFetch(RESULTS_URL);
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(body.error || 'Could not read the saved results.');
  return body.results as Results | null;
}

export async function saveResults(r: Results): Promise<void> {
  const res = await adminFetch(RESULTS_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(r),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.error || `Could not save the results (HTTP ${res.status}).`);
}

/**
 * Can this page start a `blob:` Worker? Tone's clock needs one, and only the
 * /admin CSP allows it. A page reached by client-side navigation (e.g. back
 * from /login) keeps the previous page's CSP, so this fails until a reload.
 */
export function workerProbe(): Promise<boolean> {
  return new Promise((resolve) => {
    let url = '';
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (ok: boolean) => {
      if (timer) clearTimeout(timer);
      worker?.terminate();
      if (url) URL.revokeObjectURL(url);
      resolve(ok);
    };
    try {
      url = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
      worker = new Worker(url);
    } catch {
      done(false);
      return;
    }
    worker.onmessage = () => done(true);
    worker.onerror = () => done(false);
    timer = setTimeout(() => done(false), 1000);
  });
}
