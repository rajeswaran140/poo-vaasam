import { renderHook, act } from '@testing-library/react';
import { useFormDraft } from '@/components/admin/authoring/useFormDraft';

const KEY = 'tg:content-draft:test';

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('useFormDraft', () => {
  it('is not dirty until the form changes, then autosaves (debounced)', () => {
    const apply = jest.fn();
    const { result, rerender } = renderHook(
      ({ data }) => useFormDraft('test', data, apply),
      { initialProps: { data: { title: '' } } }
    );

    expect(result.current.isDirty).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();

    rerender({ data: { title: 'காதல்' } });
    expect(result.current.isDirty).toBe(true);

    // Debounced — nothing written until the timer fires.
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => { jest.advanceTimersByTime(800); });

    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(saved.data).toEqual({ title: 'காதல்' });
    expect(result.current.savedAt).toEqual(expect.any(Number));
  });

  it('treats the loaded value as baseline when enabled flips (edit page)', () => {
    const apply = jest.fn();
    // Disabled while "loading": empty form must NOT become a draft.
    const { result, rerender } = renderHook(
      ({ data, enabled }) => useFormDraft('test', data, apply, { enabled }),
      { initialProps: { data: { title: '' }, enabled: false } }
    );

    // Content "loads" while still disabled.
    rerender({ data: { title: 'loaded' }, enabled: false });
    act(() => { jest.advanceTimersByTime(800); });
    expect(result.current.isDirty).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();

    // Now enabled with the loaded content → that's the baseline, not dirty.
    rerender({ data: { title: 'loaded' }, enabled: true });
    expect(result.current.isDirty).toBe(false);

    // A real edit is dirty and autosaves.
    rerender({ data: { title: 'loaded + edit' }, enabled: true });
    expect(result.current.isDirty).toBe(true);
    act(() => { jest.advanceTimersByTime(800); });
    expect(JSON.parse(localStorage.getItem(KEY)!).data).toEqual({ title: 'loaded + edit' });
  });

  it('detects an existing draft on mount and restores it', () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: 123, data: { title: 'recovered' } }));
    const apply = jest.fn();
    const { result } = renderHook(() => useFormDraft('test', { title: '' }, apply));

    expect(result.current.draftAvailable).toEqual({ savedAt: 123 });
    act(() => { result.current.restore(); });
    expect(apply).toHaveBeenCalledWith({ title: 'recovered' });
    expect(result.current.draftAvailable).toBeNull();
  });

  it('clear() removes the stored draft', () => {
    localStorage.setItem(KEY, JSON.stringify({ savedAt: 1, data: { title: 'x' } }));
    const { result } = renderHook(() => useFormDraft('test', { title: 'x' }, jest.fn()));
    act(() => { result.current.clear(); });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.draftAvailable).toBeNull();
  });

  it('does nothing when disabled', () => {
    const { result, rerender } = renderHook(
      ({ data }) => useFormDraft('test', data, jest.fn(), { enabled: false }),
      { initialProps: { data: { title: '' } } }
    );
    rerender({ data: { title: 'typed' } });
    act(() => { jest.advanceTimersByTime(800); });
    expect(result.current.isDirty).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
