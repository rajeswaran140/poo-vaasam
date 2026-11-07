'use client';

/**
 * The last frame of a clip, as a JPEG, grabbed in the browser — for chaining
 * ("continue from the previous clip"): it is uploaded to the next shot and
 * pinned as that clip's first frame. The clip is loaded with CORS (the media
 * bucket allows GET from the site), so the canvas is not tainted. Pass a freshly
 * signed URL: a copy cached without CORS headers would taint the canvas.
 *
 * Safari (iPhone): a detached video may never fire loadeddata and can draw
 * black until it has played, so it waits for metadata, plays a moment, pauses,
 * then seeks; an all-black frame is refused rather than paid for as a first frame.
 */

/** Just inside the end: the last frame, not the one before it. */
const SEEK_BEFORE_END_SEC = 0.001;
const JPEG_QUALITY = 0.92;
/** No channel brighter than this anywhere ⇒ a black frame. */
const BLACK_MAX = 16;

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
    const loaded = once('loadedmetadata');
    video.src = url;
    await loaded;
    try {
      await video.play();
    } catch {
      // Autoplay refused: muted inline playback is normally allowed; seeking still works on most browsers.
    }
    video.pause();
    const target = Math.max(0, video.duration - SEEK_BEFORE_END_SEC);
    if (Math.abs(video.currentTime - target) > 1e-6) {
      const seeked = once('seeked');
      video.currentTime = target;
      await seeked;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) throw new Error('The clip has no picture to copy.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bright = false;
    for (let i = 0; i < px.length && !bright; i += 4) bright = px[i] > BLACK_MAX || px[i + 1] > BLACK_MAX || px[i + 2] > BLACK_MAX;
    if (!bright) throw new Error('The copied last frame came out black. Try again, or use a different browser.');
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not copy the last frame.'))), 'image/jpeg', JPEG_QUALITY)
    );
  } finally {
    video.pause?.();
    video.removeAttribute('src');
    video.load?.();
  }
}
