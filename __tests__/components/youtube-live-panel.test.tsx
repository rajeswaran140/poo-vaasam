/** @jest-environment jsdom */
/**
 * YouTubeLivePanel — the honesty rules, which are the whole reason this panel
 * is not just four numbers in boxes. Every test here corresponds to a specific
 * way the panel could quietly mislead.
 *
 * adminFetch is mocked and routed by URL: the panel pulls overview, health and
 * timeseries together, then polls realtime separately.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { YouTubeLivePanel } from '@/components/admin/YouTubeLivePanel';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

const ok = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response);

const overview = {
  range: { key: '28d', from: '2026-06-28', to: '2026-07-25', days: 28 },
  metrics: {
    views: { value: 208378, previous: 76500, deltaPct: 172.3 },
    watchTimeHours: { value: 8942.9, previous: 2282, deltaPct: 291.9 },
    subscribersNet: { value: 720, previous: 353, deltaPct: 104, gained: 755, lost: 35 },
    estimatedRevenue: { value: 11.67, currency: 'USD' },
    revenueUnavailableReason: null,
  },
  subscribers: { count: 1118, asOf: '2026-07-27', daysSinceAnchor: 0 },
  insufficientHistory: false,
  missingDays: 0,
  availableFrom: null,
  dataStart: '2026-05-22',
  dataThroughDate: '2026-07-25',
  isPartial: true,
};

const realtime = {
  subscribersApprox: 1120,
  subscribersRounded: true,
  subscribersExact: null,
  views48h: 10838,
  views48hAvailable: true,
  windowHours: 48,
  windowExact: true,
  viewCountDecreased: false,
  snapshotAt: '2026-07-29T13:00:00Z',
};

const health = {
  status: 'ok',
  snapshots: { status: 'ok', ageMinutes: 4, lastSnapshotAt: 'x', staleAfterMinutes: 20 },
  notes: null,
};

const timeseries = {
  metric: 'views',
  points: [
    { date: '2026-07-23', value: 5442, isFinalized: true },
    { date: '2026-07-24', value: 5851, isFinalized: true },
    { date: '2026-07-25', value: 5631, isFinalized: false },
  ],
};

function route(over: Partial<Record<string, unknown>> = {}) {
  mockedFetch.mockImplementation((url: string) => {
    if (url.includes('/overview')) return ok(over.overview ?? overview);
    if (url.includes('/realtime')) return ok(over.realtime ?? realtime);
    if (url.includes('/analytics-health')) return ok(over.health ?? health);
    if (url.includes('/timeseries')) return ok(over.timeseries ?? timeseries);
    return Promise.resolve({ ok: false, json: async () => ({}) } as Response);
  });
}

beforeEach(() => {
  mockedFetch.mockReset();
  window.localStorage.clear();
});

describe('KPI tiles', () => {
  it('renders the headline metrics', async () => {
    route();
    render(<YouTubeLivePanel />);
    expect(await screen.findByText('208.4K')).toBeInTheDocument();
    expect(screen.getByText('+720')).toBeInTheDocument();
  });

  it('shows direction with a glyph, not colour alone', async () => {
    route();
    render(<YouTubeLivePanel />);
    // ▲ must be present so the meaning survives colour-blindness / greyscale.
    await waitFor(() => expect(screen.getAllByText('▲').length).toBeGreaterThan(0));
  });
});

describe('honesty rule: a null delta is never printed as 0%', () => {
  it('says there is no comparison instead of implying flat', async () => {
    route({
      overview: {
        ...overview,
        metrics: { ...overview.metrics, views: { value: 500, previous: 0, deltaPct: null } },
      },
    });
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/no comparison/i)).toBeInTheDocument();
    expect(screen.queryByText(/0\.0% more/)).not.toBeInTheDocument();
  });
});

describe('honesty rule: ranges without history are disabled, not zero-padded', () => {
  it('disables 90d and names the date it becomes available', async () => {
    route();
    render(<YouTubeLivePanel />);
    // findByRole resolves on the FIRST render, before the overview arrives and
    // availability can be computed — so wait for the loaded state explicitly.
    await waitFor(() => {
      const o = screen.getByRole('option', { name: /Last 90 days/ }) as HTMLOptionElement;
      expect(o.disabled).toBe(true);
    });
    const opt = screen.getByRole('option', { name: /Last 90 days/ }) as HTMLOptionElement;
    expect(opt.textContent).toMatch(/from 2026-11-17/);
  });

  it('leaves 28d selectable on the same history', async () => {
    route();
    render(<YouTubeLivePanel />);
    await screen.findByText('208.4K'); // wait for the loaded state
    const opt = screen.getByRole('option', { name: /Last 28 days/ }) as HTMLOptionElement;
    expect(opt.disabled).toBe(false);
  });

  it('explains itself rather than showing zeroed tiles when the range is blocked', async () => {
    route({
      overview: { ...overview, insufficientHistory: true, missingDays: 115, availableFrom: '2026-11-17' },
    });
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/Not enough history/i)).toBeInTheDocument();
    expect(screen.queryByText('208.4K')).not.toBeInTheDocument();
  });
});

describe('honesty rule: the 48h tile states its real window', () => {
  it('labels a gapped window with the true elapsed hours', async () => {
    route({ realtime: { ...realtime, windowHours: 61, windowExact: false } });
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/last 61h/i)).toBeInTheDocument();
  });

  it('shows a dash, not a wrong number, before 48h of snapshots exist', async () => {
    route({ realtime: { ...realtime, views48h: null, views48hAvailable: false } });
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/needs ~48h of snapshots/i)).toBeInTheDocument();
  });
});

describe('health dot', () => {
  it('reads as unknown, NOT as an alarm, before the check returns', () => {
    // Never resolves — this is the first-paint state.
    mockedFetch.mockImplementation(() => new Promise(() => {}));
    render(<YouTubeLivePanel />);
    expect(screen.getByText('checking…')).toBeInTheDocument();
    expect(screen.queryByText(/stale/i)).not.toBeInTheDocument();
  });

  it('surfaces a stale snapshot stream with its age', async () => {
    route({
      health: {
        status: 'error',
        snapshots: { status: 'stale', ageMinutes: 240, lastSnapshotAt: 'x', staleAfterMinutes: 20 },
        notes: 'No channel snapshot for 240 minutes',
      },
    });
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/snapshots stale \(240 min\)/i)).toBeInTheDocument();
  });
});

describe('provisional data', () => {
  it('warns that the trailing days are still settling', async () => {
    route();
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/still settling/i)).toBeInTheDocument();
  });

  it('marks the window as partial so it is not read as final', async () => {
    route();
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/subject to revision/i)).toBeInTheDocument();
  });
});

describe('subscriber precision', () => {
  it('marks the rounded live figure and shows the exact one separately', async () => {
    route();
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/Subscribers \(≈\)/)).toBeInTheDocument();
    expect(screen.getByText(/exact 1,118 as of 2026-07-27/)).toBeInTheDocument();
  });
});

describe('resilience', () => {
  it('degrades to an error line instead of throwing when the payload is malformed', async () => {
    route({ overview: { totally: 'wrong' } });
    render(<YouTubeLivePanel />);
    expect(await screen.findByText(/unexpected shape/i)).toBeInTheDocument();
  });
});

describe('metric toggle — daily subscribers', () => {
  it('offers Views, Watch time and Subscribers', async () => {
    route();
    render(<YouTubeLivePanel />);
    expect(await screen.findByRole('button', { name: 'Subscribers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Watch time' })).toBeInTheDocument();
  });

  it('marks the active metric with aria-pressed, and moves it on click', async () => {
    route();
    render(<YouTubeLivePanel />);
    const subs = await screen.findByRole('button', { name: 'Subscribers' });
    expect(screen.getByRole('button', { name: 'Views' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(subs);
    await waitFor(() => expect(subs).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Views' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('requests the netSubscribers series when Subscribers is chosen', async () => {
    route();
    render(<YouTubeLivePanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribers' }));
    await waitFor(() =>
      expect(
        mockedFetch.mock.calls.some(([u]: [string]) => u.includes('metric=netSubscribers'))
      ).toBe(true)
    );
  });

  it('breaks out gained vs lost, so net does not hide the unsubscribes', async () => {
    route();
    render(<YouTubeLivePanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribers' }));
    expect(await screen.findByText(/\+755/)).toBeInTheDocument();
    expect(screen.getByText(/−35/)).toBeInTheDocument();
  });

  it('states plainly that subscriber identities are not available', async () => {
    route();
    render(<YouTubeLivePanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Subscribers' }));
    expect(await screen.findByText(/does not\s+expose who subscribed/i)).toBeInTheDocument();
  });
});
