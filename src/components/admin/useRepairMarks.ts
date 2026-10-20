// src/components/admin/useRepairMarks.ts
'use client';
/**
 * Client state for one saved master's repair marks.
 *
 * A create shows a PENDING row at once, so pressing M three times is three
 * rows even before the saves return, and a failed save keeps its row with the
 * error in it (row errors must render in the row). An edit sends the version
 * it was based on; a 409 means another tab saved first, so the list reloads
 * and says so rather than overwriting.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { sortMarks, type RepairMark, type NewMarkInput, type MarkPatch } from '@/lib/repair-marks';

export interface PendingMark {
  tempId: string;
  input: NewMarkInput;
  error: string | null;
}

export function useRepairMarks(masterJobId: string | null) {
  const [marks, setMarks] = useState<RepairMark[] | null>(null);
  const [pending, setPending] = useState<PendingMark[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const seq = useRef(0);
  const base = masterJobId ? `/api/admin/music-lab/master/${encodeURIComponent(masterJobId)}/marks` : null;

  const reload = useCallback(async () => {
    if (!base) return;
    try {
      const res = await adminFetch(base);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not load the marks.');
      setMarks(sortMarks(body.marks as RepairMark[]));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the marks.');
    }
  }, [base]);

  useEffect(() => {
    setMarks(null);
    setPending([]);
    setRowErrors({});
    setNotice(null);
    void reload();
  }, [reload]);

  const create = useCallback(async (input: NewMarkInput) => {
    if (!base) return;
    const tempId = `pending-${seq.current++}`;
    setPending((p) => [...p, { tempId, input, error: null }]);
    try {
      const res = await adminFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save the mark.');
      setPending((p) => p.filter((x) => x.tempId !== tempId));
      setMarks((m) => sortMarks([...(m ?? []), body.mark as RepairMark]));
    } catch (e) {
      const error = e instanceof Error ? e.message : 'Could not save the mark.';
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, error } : x)));
    }
  }, [base]);

  const update = useCallback(async (markId: string, patch: MarkPatch): Promise<boolean> => {
    if (!base) return false;
    const current = marks?.find((m) => m.markId === markId);
    if (!current) return false;
    setRowErrors((r) => { const { [markId]: _gone, ...rest } = r; return rest; });
    try {
      const res = await adminFetch(`${base}/${encodeURIComponent(markId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: current.version, ...patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.code === 'stale') {
        setNotice('Changed in another tab — reloaded.');
        await reload();
        return false;
      }
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not save the mark.');
      setMarks((m) => sortMarks((m ?? []).map((x) => (x.markId === markId ? (body.mark as RepairMark) : x))));
      return true;
    } catch (e) {
      setRowErrors((r) => ({ ...r, [markId]: e instanceof Error ? e.message : 'Could not save the mark.' }));
      return false;
    }
  }, [base, marks, reload]);

  const remove = useCallback(async (markId: string) => {
    if (!base) return;
    try {
      const res = await adminFetch(`${base}/${encodeURIComponent(markId)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) throw new Error(body.error || 'Could not delete the mark.');
      setMarks((m) => (m ?? []).filter((x) => x.markId !== markId));
    } catch (e) {
      setRowErrors((r) => ({ ...r, [markId]: e instanceof Error ? e.message : 'Could not delete the mark.' }));
    }
  }, [base]);

  const discardPending = useCallback((tempId: string) => {
    setPending((p) => p.filter((x) => x.tempId !== tempId));
  }, []);

  return { marks, pending, loadError, notice, rowErrors, create, update, remove, discardPending, reload };
}

export type RepairMarksState = ReturnType<typeof useRepairMarks>;
