/** @jest-environment jsdom */
/**
 * grabLastFrame: loads the clip with CORS (or the canvas is tainted), seeks to
 * just before the end, and returns a JPEG of that frame; a clip that will not
 * load is an error, never an empty picture.
 */
import { grabLastFrame } from '@/lib/visual-story-last-frame';

let video: HTMLVideoElement;
const realCreate = document.createElement.bind(document);
const drawImage = jest.fn();

beforeEach(() => {
  drawImage.mockReset();
  jest.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === 'video') {
      video = el as HTMLVideoElement;
      Object.defineProperty(video, 'duration', { value: 8, configurable: true });
      Object.defineProperty(video, 'videoWidth', { value: 1080, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 1920, configurable: true });
      jest.spyOn(video, 'load').mockImplementation(() => {});
    }
    return el;
  });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage }) as never);
  jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
    cb(new Blob(['jpeg'], { type }));
  });
});
afterEach(() => jest.restoreAllMocks());

it('loads with CORS, seeks to the end, and returns a JPEG of that frame', async () => {
  const p = grabLastFrame('https://s3/clip.mp4');
  expect(video.crossOrigin).toBe('anonymous');
  video.dispatchEvent(new Event('loadeddata'));
  await Promise.resolve();
  expect(video.currentTime).toBeCloseTo(7.95, 2);
  video.dispatchEvent(new Event('seeked'));
  const blob = await p;
  expect(blob.type).toBe('image/jpeg');
  expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1080, 1920);
});

it('a clip that will not load is an error', async () => {
  const p = grabLastFrame('https://s3/clip.mp4');
  video.dispatchEvent(new Event('error'));
  await expect(p).rejects.toThrow('The clip could not be loaded.');
});
