/** @jest-environment jsdom */
/**
 * MasteringWaveform — the offscreen layers must be built once per SIZE change.
 *
 * The move from SVG to canvas exists to keep per-frame work off the playhead
 * path: the bars are drawn once into an unplayed layer and a played layer, and
 * each frame composites them with a clip rect. That guarantee was silently lost
 * because the layer-building effect listed `paint` in its dependencies, and
 * `paint` closes over `position` — so a new `paint` on every tick rebuilt both
 * canvases, re-binned every peak, and churned the ResizeObserver ~10x/second.
 *
 * These tests count canvas construction, which is the cheapest observable proxy
 * for that work.
 */

import { render } from '@testing-library/react';
import { MasteringWaveform } from '@/components/admin/MasteringWaveform';

let canvasCount = 0;
let observerCount = 0;

beforeEach(() => {
  canvasCount = 0;
  observerCount = 0;

  const realCreate = document.createElement.bind(document);
  jest.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: unknown[]) => {
    if (tag === 'canvas') canvasCount++;
    return (realCreate as unknown as (t: string, ...r: unknown[]) => HTMLElement)(tag, ...rest);
  }) as typeof document.createElement);

  // jsdom canvases have no 2d context; stub the drawing surface.
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
    scale: () => {}, fillRect: () => {}, clearRect: () => {}, setTransform: () => {},
    drawImage: () => {}, save: () => {}, restore: () => {}, beginPath: () => {},
    rect: () => {}, clip: () => {}, fillStyle: '',
  });

  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { value: 600, configurable: true });

  class FakeRO {
    constructor(readonly cb: () => void) { observerCount++; }
    observe() {}
    disconnect() {}
  }
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
});

afterEach(() => jest.restoreAllMocks());

const peaks = Array.from({ length: 1200 }, (_, i) => (i % 17) / 17);

const view = (position: number, marks: readonly number[] = [10, 20]) => (
  <MasteringWaveform
    peaks={peaks}
    duration={200}
    position={position}
    loop={null}
    marks={marks}
    onSeek={() => {}}
    onLoopDrag={() => {}}
  />
);

describe('layer rebuild cost', () => {
  it('does not rebuild the layers when only the playhead moves', () => {
    const { rerender } = render(view(0));
    const afterMount = canvasCount;

    // Ten ticks — one second of playback at the parent's 10Hz display gate.
    for (let i = 1; i <= 10; i++) rerender(view(i));

    // Before the fix this was 20: two fresh offscreen canvases per tick.
    expect(canvasCount - afterMount).toBe(0);
  });

  it('does not churn the ResizeObserver on every tick', () => {
    const { rerender } = render(view(0));
    const afterMount = observerCount;
    for (let i = 1; i <= 10; i++) rerender(view(i));
    expect(observerCount - afterMount).toBe(0);
  });

  it('survives a caller that passes a fresh marks array each render', () => {
    // The parent memoises this now, but the child must not depend on it doing so.
    const { rerender } = render(view(0, [10, 20]));
    const afterMount = canvasCount;
    for (let i = 1; i <= 10; i++) rerender(view(i, [10, 20]));
    expect(canvasCount - afterMount).toBe(0);
  });

  it('DOES rebuild when the bars themselves change', () => {
    const { rerender } = render(view(0));
    const afterMount = canvasCount;
    const otherPeaks = Array.from({ length: 1200 }, (_, i) => (i % 5) / 5);
    rerender(
      <MasteringWaveform
        peaks={otherPeaks}
        duration={200}
        position={0}
        loop={null}
        marks={[10, 20]}
        onSeek={() => {}}
        onLoopDrag={() => {}}
      />
    );
    // Two layers: unplayed and played.
    expect(canvasCount - afterMount).toBe(2);
  });

  it('rebuilds when the height changes', () => {
    const { rerender } = render(view(0));
    const afterMount = canvasCount;
    rerender(
      <MasteringWaveform
        peaks={peaks}
        duration={200}
        position={0}
        loop={null}
        marks={[10, 20]}
        height={120}
        onSeek={() => {}}
        onLoopDrag={() => {}}
      />
    );
    expect(canvasCount - afterMount).toBe(2);
  });
});
