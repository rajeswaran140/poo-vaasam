/** @jest-environment jsdom */
import { render, screen, act } from '@testing-library/react';
import { LazyMount } from '@/components/admin/LazyMount';

describe('LazyMount', () => {
  const orig = (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  afterEach(() => {
    (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = orig;
  });

  it('mounts eagerly when IntersectionObserver is unavailable (SSR/jsdom fallback)', () => {
    delete (global as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    render(
      <LazyMount>
        <div>heavy panel</div>
      </LazyMount>
    );
    expect(screen.getByText('heavy panel')).toBeInTheDocument();
  });

  it('defers children until scrolled into view, then mounts them', () => {
    let cb: (entries: Array<{ isIntersecting: boolean }>) => void = () => {};
    class MockIO {
      constructor(fn: (entries: Array<{ isIntersecting: boolean }>) => void) {
        cb = fn;
      }
      observe() {}
      disconnect() {}
    }
    (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIO;

    render(
      <LazyMount>
        <div>heavy panel</div>
      </LazyMount>
    );
    // Not mounted before it scrolls into view.
    expect(screen.queryByText('heavy panel')).not.toBeInTheDocument();

    act(() => cb([{ isIntersecting: true }]));
    expect(screen.getByText('heavy panel')).toBeInTheDocument();
  });
});
