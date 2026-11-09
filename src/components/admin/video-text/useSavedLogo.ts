'use client';

/**
 * The one saved logo: loaded once for the editor (its details and the image,
 * decoded so the preview and the render's PNG can draw it), and replaced by
 * an upload.
 *
 * The image is fetched (CORS) into a blob and decoded from that, so drawing
 * it never taints the canvas the render's PNG is made from.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { LOGO_TYPES, MAX_LOGO_BYTES } from '@/lib/video-text/logo';
import type { SavedLogo } from '@/types/videoText';

/** A decoded logo, ready to draw. */
export interface LogoImage {
  image: CanvasImageSource & { width: number; height: number };
  width: number;
  height: number;
  /** Changes when the logo is replaced, so a drawing keyed on it redraws. */
  key: string;
}

export type LogoState =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'ready'; logo: SavedLogo & { url: string }; image: LogoImage }
  | { kind: 'error'; message: string };

const LOAD_FAILED = 'The saved logo could not be loaded — reload the page to try again.';

async function decode(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  // Fallback (older Safari): an <img> from an object URL.
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Why this file cannot be the logo, or null. */
export function logoFileProblem(file: File): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return 'The logo must be a PNG, JPG or WebP image.';
  if (file.size > MAX_LOGO_BYTES) return 'The logo must be 5 MB or smaller.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export function useSavedLogo() {
  const [state, setState] = useState<LogoState>({ kind: 'loading' });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await adminFetch('/api/admin/video-text/logo');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || LOAD_FAILED);
        const logo = body?.logo as (SavedLogo & { url: string }) | null;
        if (!logo) {
          if (!cancelled) setState({ kind: 'none' });
          return;
        }
        const img = await fetch(logo.url);
        if (!img.ok) throw new Error(LOAD_FAILED);
        const image = await decode(await img.blob());
        if (!cancelled) setState({ kind: 'ready', logo, image: { image, width: image.width, height: image.height, key: logo.key } });
      } catch {
        if (!cancelled) setState({ kind: 'error', message: LOAD_FAILED });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Upload `file` as THE logo (replacing any saved one). */
  const upload = useCallback(async (file: File) => {
    setUploadError(null);
    const problem = logoFileProblem(file);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploading(true);
    try {
      let image: CanvasImageSource & { width: number; height: number };
      try {
        image = await decode(file);
      } catch {
        throw new Error('That image could not be read — try another file.');
      }
      const pre = await adminFetch('/api/admin/video-text/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: file.type }),
      });
      const preBody = await pre.json().catch(() => ({}));
      if (!pre.ok || typeof preBody?.url !== 'string') throw new Error(preBody?.error || 'Could not prepare the logo upload.');
      await putToS3(preBody.url, preBody.fields, file, () => {}, new AbortController().signal);
      const saved = await adminFetch('/api/admin/video-text/logo', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: preBody.key, width: image.width, height: image.height }),
      });
      const savedBody = await saved.json().catch(() => ({}));
      if (!saved.ok || !savedBody?.logo) throw new Error(savedBody?.error || 'Could not save the logo.');
      const logo = savedBody.logo as SavedLogo & { url: string };
      if (live.current) setState({ kind: 'ready', logo, image: { image, width: image.width, height: image.height, key: logo.key } });
    } catch (err) {
      if (live.current) setUploadError(err instanceof Error ? err.message : 'The logo upload failed — try again.');
    } finally {
      if (live.current) setUploading(false);
    }
  }, []);

  return { state, upload, uploading, uploadError };
}
