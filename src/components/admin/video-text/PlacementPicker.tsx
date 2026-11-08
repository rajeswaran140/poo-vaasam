'use client';

/**
 * A 3×3 grid of where a title or credits block sits on the picture: top,
 * middle or bottom, by left, centre or right. One radio per cell; arrow keys
 * move between cells.
 */
import type { KeyboardEvent } from 'react';
import { CENTRE_PLACEMENT, type Placement } from '@/types/videoText';

const ROWS: Placement['v'][] = ['top', 'middle', 'bottom'];
const COLS: Placement['h'][] = ['left', 'center', 'right'];
const V_NAME: Record<Placement['v'], string> = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };
const H_NAME: Record<Placement['h'], string> = { left: 'left', center: 'centre', right: 'right' };

export function placementName(p: Placement): string {
  return p.v === 'middle' && p.h === 'center' ? 'Centre' : `${V_NAME[p.v]} ${H_NAME[p.h]}`;
}

export interface PlacementPickerProps {
  label: string;
  value: Placement | undefined;
  onChange(p: Placement): void;
}

export function PlacementPicker({ label, value, onChange }: PlacementPickerProps) {
  const current = value ?? CENTRE_PLACEMENT;

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const r = ROWS.indexOf(current.v);
    const c = COLS.indexOf(current.h);
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const nr = Math.min(2, Math.max(0, r + d[0]));
    const nc = Math.min(2, Math.max(0, c + d[1]));
    onChange({ v: ROWS[nr], h: COLS[nc] });
    // Keep focus on the newly checked cell.
    const grid = e.currentTarget.parentElement;
    requestAnimationFrame(() =>
      grid?.querySelector<HTMLButtonElement>(`[data-cell="${ROWS[nr]}-${COLS[nc]}"]`)?.focus(),
    );
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100" aria-hidden="true">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={`${label} position`}
        className="grid aspect-video w-24 grid-cols-3 grid-rows-3 gap-px overflow-hidden rounded border border-gray-300 bg-gray-300 dark:border-gray-600 dark:bg-gray-600"
      >
        {ROWS.flatMap((v) =>
          COLS.map((h) => {
            const on = current.v === v && current.h === h;
            const name = placementName({ v, h });
            return (
              <button
                key={`${v}-${h}`}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={name}
                title={name}
                data-cell={`${v}-${h}`}
                tabIndex={on ? 0 : -1}
                onClick={() => onChange({ v, h })}
                onKeyDown={onKey}
                className={`focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 ${
                  on ? 'bg-orange-600' : 'bg-white hover:bg-orange-100 dark:bg-gray-900 dark:hover:bg-gray-800'
                }`}
              />
            );
          }),
        )}
      </div>
      <span className="w-24 text-xs text-gray-500 dark:text-gray-400">{placementName(current)}</span>
    </div>
  );
}
