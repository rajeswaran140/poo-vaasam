'use client';

/**
 * The last frame of a clip, as a JPEG, grabbed in the browser — for chaining
 * ("continue from the previous clip"): it is uploaded to the next shot and
 * pinned as that clip's first frame. The clip is loaded with CORS (the media
 * bucket allows GET from the site), so the canvas is not tainted. Pass a freshly
 * signed URL: a copy cached without CORS headers would taint the canvas.
 */

const SEEK_BEFORE_END_SEC = 0.05;
const JPEG_QUALITY = 0.92;

export async function grabLastFrame(url: string, timeoutMs = 30_000): Promise<Blob> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  const once = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The clip took too long to load.')), timeoutMs);
      video.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
      video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('The clip could not be loaded.')); }, { once: true });
    });

  try {
    const loaded = once('loadeddata');
    video.src = url;
    await loaded;
    const seeked = once('seeked');
    video.currentTime = Math.max(0, video.duration - SEEK_BEFORE_END_SEC);
    await seeked;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) throw new Error('The clip has no picture to copy.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not copy the last frame.'))), 'image/jpeg', JPEG_QUALITY)
    );
  } finally {
    video.removeAttribute('src');
    video.load?.();
  }
}
