/** @jest-environment jsdom */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowKanban, inferState, relativeTime, type WorkflowItem } from '@/components/admin/WorkflowKanban';

const NOW = Date.parse('2026-05-31T12:00:00Z');

const ITEMS: WorkflowItem[] = [
  // Implicit Live (PUBLISHED, no workflowState)
  { id: 'cnt_1', title: 'அந்தி மேகமே', type: 'SONGS', status: 'PUBLISHED', updatedAt: '2026-05-31T10:00:00Z' },
  // Explicit MIDI review (song mid-pipeline)
  { id: 'cnt_2', title: 'என்ன மாயம்',   type: 'SONGS', status: 'PUBLISHED', workflowState: 'midi_reviewed', updatedAt: '2026-05-30T08:00:00Z' },
  // Implicit Draft (DRAFT status, no workflowState)
  { id: 'cnt_3', title: 'Draft Song',  type: 'SONGS', status: 'DRAFT',     updatedAt: '2026-05-29T08:00:00Z' },
  // Poem in Live
  { id: 'cnt_4', title: 'அம்மா',        type: 'POEMS', status: 'PUBLISHED', updatedAt: '2026-05-31T11:00:00Z' },
];

describe('inferState', () => {
  it('uses explicit workflowState when present + valid', () => {
    const { state, explicit } = inferState(ITEMS[1]);
    expect(state).toBe('midi_reviewed');
    expect(explicit).toBe(true);
  });
  it('infers published_site for PUBLISHED rows without workflowState', () => {
    expect(inferState(ITEMS[0])).toEqual({ state: 'published_site', explicit: false });
  });
  it('infers draft for non-published rows without workflowState', () => {
    expect(inferState(ITEMS[2])).toEqual({ state: 'draft', explicit: false });
  });
  it('falls back to inference when workflowState is an unknown string', () => {
    const { state, explicit } = inferState({
      id: 'cnt_x', title: 'x', type: 'SONGS', status: 'PUBLISHED', workflowState: 'invented',
    });
    expect(state).toBe('published_site');
    expect(explicit).toBe(false);
  });
});

describe('relativeTime', () => {
  it('shows compact ago strings + falls back to date past 30d', () => {
    expect(relativeTime('2026-05-31T11:59:30Z', NOW)).toBe('now');                  // <60s
    expect(relativeTime('2026-05-31T11:50:00Z', NOW)).toBe('10m ago');
    expect(relativeTime('2026-05-31T08:00:00Z', NOW)).toBe('4h ago');
    expect(relativeTime('2026-05-29T12:00:00Z', NOW)).toBe('2d ago');
    expect(relativeTime('2026-03-01T12:00:00Z', NOW)).toMatch(/\d{4}/);             // date string
  });
  it('returns — for missing/bad input', () => {
    expect(relativeTime(undefined, NOW)).toBe('—');
    expect(relativeTime('not-a-date', NOW)).toBe('—');
  });
});

describe('<WorkflowKanban />', () => {
  it('renders all 9 column headers', () => {
    render(<WorkflowKanban items={ITEMS} />);
    // Column headers are labelled regions — query by aria-label to avoid
    // matching the same words inside WorkflowSelect's dropdown options.
    for (const label of ['Draft', 'Lyrics', 'AI Review', 'Music', 'MIDI', 'Stems', 'Video', 'YouTube', 'Live']) {
      expect(screen.getByLabelText(`${label} column`)).toBeInTheDocument();
    }
  });

  it('shows the completion summary chips', () => {
    render(<WorkflowKanban items={ITEMS} />);
    // ITEMS: cnt_1 (PUBLISHED, no state) → Live, cnt_2 (PUBLISHED, MIDI) → in pipeline,
    // cnt_3 (DRAFT) → in pipeline (Draft column), cnt_4 (PUBLISHED, no state) → Live.
    // So Live = 2, in-pipeline = 2.
    expect(screen.getByText(/2 Live/)).toBeInTheDocument();
    expect(screen.getByText(/2 in pipeline/)).toBeInTheDocument();
  });

  it('shows "X shown of Y" tally', () => {
    render(<WorkflowKanban items={ITEMS} />);
    expect(screen.getByText('4 shown of 4')).toBeInTheDocument();
  });

  it('filters by type — picking POEMS hides the songs', () => {
    render(<WorkflowKanban items={ITEMS} />);
    expect(screen.getByText('அம்மா')).toBeInTheDocument();
    expect(screen.getByText('என்ன மாயம்')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'POEMS' } });

    expect(screen.getByText('அம்மா')).toBeInTheDocument();
    expect(screen.queryByText('என்ன மாயம்')).not.toBeInTheDocument();
    expect(screen.getByText('1 shown of 4')).toBeInTheDocument();
  });

  it('shows the empty-pipeline callout when no items match the filter', () => {
    render(<WorkflowKanban items={[]} />);
    expect(screen.getByText(/No content/i)).toBeInTheDocument();
  });

  it('renders the "auto" tag on inferred cards but not on explicit ones', () => {
    render(<WorkflowKanban items={ITEMS} />);
    // cnt_2 has an explicit state → no "auto" near its title's chip area
    const explicit = screen.getByText('என்ன மாயம்').closest('article');
    expect(explicit?.textContent).not.toMatch(/auto/);
    // cnt_1 / cnt_3 / cnt_4 are inferred — at least one "auto" tag must exist
    expect(screen.getAllByText(/auto/i).length).toBeGreaterThan(0);
  });
});
