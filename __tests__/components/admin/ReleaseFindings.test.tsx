/** @jest-environment jsdom */
/**
 * The ONE renderer for a release-checklist finding, shared by /admin/release and
 * the Mastering Studio's upload panel.
 *
 * The property under test is the one both screens rest on: a check that could
 * not run is shown as neither a pass nor a problem. It used to be enforced by
 * two independent copies of the same tone map and the same three filters, which
 * is how `not-checked` reached one screen as `undefined` in the first place.
 */

import { render, screen } from '@testing-library/react';
import type { Finding } from '@/lib/release-checklist';
import { FINDING_TONE, FindingRow, groupFindings } from '@/components/admin/ReleaseFindings';

const finding = (over: Partial<Finding>): Finding => ({
  id: 'x',
  severity: 'gap',
  title: 'A title',
  detail: 'A detail',
  ...over,
});

describe('groupFindings', () => {
  it('keeps a not-checked finding out of the actionable list AND out of the notes', () => {
    const groups = groupFindings([
      finding({ id: 'tags', severity: 'gap', title: 'Only 2 tags' }),
      finding({ id: 'lang', severity: 'blocker', title: 'No audio language' }),
      finding({ id: 'thumb', severity: 'note', title: 'Thumbnail is auto-generated' }),
      finding({ id: 'density', severity: 'not-checked', title: 'Release density not checked' }),
    ]);

    expect(groups.actionable.map((f) => f.id)).toEqual(['tags', 'lang']);
    expect(groups.notes.map((f) => f.id)).toEqual(['thumb']);
    expect(groups.notChecked.map((f) => f.id)).toEqual(['density']);
  });

  it('survives an absent findings list', () => {
    expect(groupFindings(undefined)).toEqual({ actionable: [], notes: [], notChecked: [] });
  });
});

describe('FindingRow', () => {
  it('renders a not-checked finding muted and dashed — never as a pass', () => {
    render(
      <ul>
        <FindingRow f={finding({ severity: 'not-checked', title: 'Release density not checked' })} />
      </ul>
    );
    const badge = screen.getByText('Not checked');
    // Muted + dashed + italic, and none of the tick/green vocabulary a pass uses.
    expect(badge.className).toContain('border-dashed');
    expect(badge.className).toContain('italic');
    expect(badge.className).toContain('text-slate-400');
    expect(badge.className).not.toMatch(/emerald|green/);
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
  });

  it('gives every severity a tone, so a new one cannot render as undefined', () => {
    // The crash this module exists to prevent: a Record over a stale set of
    // keys returns undefined and the caller reads `.badge` off it.
    for (const severity of ['blocker', 'gap', 'note', 'not-checked'] as const) {
      expect(FINDING_TONE[severity]).toBeDefined();
      render(
        <ul>
          <FindingRow f={finding({ id: severity, severity, title: `t-${severity}` })} />
        </ul>
      );
      expect(screen.getByText(`t-${severity}`)).toBeInTheDocument();
    }
  });
});
