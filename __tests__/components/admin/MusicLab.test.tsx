/** @jest-environment jsdom */
/**
 * MusicLab — loads briefs, lets you pick one, log a generation against it, and
 * shows the logged attempt. Verifies the POST payload shape and the
 * success⇒hide-failure-reason interplay. adminFetch + MediaUploadField mocked.
 */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('lucide-react', () => ({
  FlaskConical: () => <svg data-testid="i-flask" />,
  Loader2: () => <svg data-testid="i-loader" />,
  Plus: () => <svg data-testid="i-plus" />,
  Trash2: () => <svg data-testid="i-trash" />,
  Lightbulb: () => <svg data-testid="i-bulb" />,
}));
jest.mock('@/components/admin/MediaUploadField', () => ({
  // Controlled input so tests can set an audio URL and exercise the measure path.
  MediaUploadField: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input data-testid="media-upload" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MusicLab } from '@/components/admin/MusicLab';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

const BRIEF = {
  id: 'brief_1',
  createdAt: '2026-06-24T10:00:00.000Z',
  updatedAt: '2026-06-24T10:00:00.000Z',
  lyrics: 'காதல் வரிகள்',
  analysis: {
    song_titles: ['டெஸ்ட் பாடல்'],
    suno_prompts: [{ style: 'Devotional', prompt: 'x' }, { style: 'Folk', prompt: 'y' }],
  },
};

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data, ...extra }),
});

function routeFetch(impl?: (url: string, opts?: RequestInit) => unknown) {
  mockedFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (impl) {
      const r = impl(url, opts);
      if (r) return Promise.resolve(r);
    }
    if (url.startsWith('/api/admin/briefs')) return Promise.resolve(ok([BRIEF]));
    if (url.startsWith('/api/admin/generations') && (!opts || opts.method !== 'POST')) return Promise.resolve(ok([]));
    return Promise.resolve(ok(null));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  routeFetch();
});

async function selectBrief() {
  render(<MusicLab />);
  const select = await screen.findByLabelText('Brief');
  fireEvent.change(select, { target: { value: 'brief_1' } });
  // The capture form appears once a brief is selected.
  await screen.findByText('Log a generation');
}

it('loads briefs and reveals the capture form on selection', async () => {
  await selectBrief();
  expect(mockedFetch).toHaveBeenCalledWith('/api/admin/briefs?limit=500');
  // Insights feed pulls the whole log, not a capped slice.
  expect(mockedFetch).toHaveBeenCalledWith('/api/admin/generations?all=true');
  // Generations are fetched for the chosen brief.
  await waitFor(() =>
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/generations?briefId=brief_1'))
  );
  // Style variants from the brief populate the dropdown.
  expect(screen.getByRole('option', { name: 'Devotional' })).toBeInTheDocument();
});

it('hides the failure-reason picker on a success verdict', async () => {
  await selectBrief();
  expect(screen.getByText('Primary issue')).toBeInTheDocument(); // default verdict = failed
  fireEvent.click(screen.getByRole('radio', { name: /success/i }));
  expect(screen.queryByText('Primary issue')).not.toBeInTheDocument();
});

it('POSTs the generation and renders the new attempt card', async () => {
  const posted: RequestInit[] = [];
  routeFetch((url, opts) => {
    if (url === '/api/admin/generations' && opts?.method === 'POST') {
      posted.push(opts);
      const body = JSON.parse(opts.body as string);
      return { ok: true, status: 201, json: async () => ({ success: true, data: { ...body, id: 'gen_1', createdAt: '2026-06-24T11:00:00.000Z' } }) };
    }
    return undefined;
  });

  await selectBrief();
  fireEvent.change(screen.getByLabelText('Melody'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'great flute intro' } });
  // verdict defaults to 'failed'; pick a failure reason
  fireEvent.change(screen.getByLabelText('Primary issue'), { target: { value: 'vocal_delivery' } });
  fireEvent.click(screen.getByRole('button', { name: /log generation/i }));

  await waitFor(() => expect(posted).toHaveLength(1));
  const body = JSON.parse(posted[0].body as string);
  expect(body).toMatchObject({
    briefId: 'brief_1',
    engine: 'suno',
    chosenStyle: 'Devotional',
    verdict: 'failed',
    failureReason: 'vocal_delivery',
    notes: 'great flute intro',
    scores: { melody: 8 },
  });

  // The logged attempt shows up in the list.
  expect(await screen.findByText('great flute intro')).toBeInTheDocument();
});

it('sends voice + custom model + stem revisions from the Advanced section', async () => {
  const posted: RequestInit[] = [];
  routeFetch((url, opts) => {
    if (url === '/api/admin/generations' && opts?.method === 'POST') {
      posted.push(opts);
      const body = JSON.parse(opts.body as string);
      return { ok: true, status: 201, json: async () => ({ success: true, data: { ...body, id: 'gen_a', createdAt: '2026-07-05T00:00:00.000Z' } }) };
    }
    return undefined;
  });

  await selectBrief();
  // Advanced fields live in the DOM even while collapsed.
  fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'Anitha' } });
  fireEvent.change(screen.getByLabelText('Custom Model'), { target: { value: 'devotional-pathos' } });
  // Blank lines / whitespace are dropped; the rest becomes an array.
  fireEvent.change(screen.getByLabelText(/Stem revisions/), { target: { value: 're-sang lead\n\n  swapped flute for veena  \n' } });
  fireEvent.click(screen.getByRole('button', { name: /log generation/i }));

  await waitFor(() => expect(posted).toHaveLength(1));
  const body = JSON.parse(posted[0].body as string);
  expect(body.settings).toMatchObject({ voiceLabel: 'Anitha', customModel: 'devotional-pathos' });
  expect(body.stemRevisions).toEqual(['re-sang lead', 'swapped flute for veena']);
});

it('shows insights computed from the global generations feed', async () => {
  const feed = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, briefId: 'brief_1', verdict: 'success', engine: 'suno', scores: {}, settings: {} })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `f${i}`, briefId: 'brief_1', verdict: 'failed', failureReason: 'mixing', engine: 'suno', scores: {}, settings: {} })),
  ];
  routeFetch((url, opts) => {
    // the cross-brief feed (mount) carries no briefId; per-brief fetch does
    if (url.startsWith('/api/admin/generations') && (!opts || opts.method !== 'POST') && !url.includes('briefId')) {
      return ok(feed);
    }
    return undefined;
  });
  render(<MusicLab />);
  expect(await screen.findByText(/Insights — 10 logged/)).toBeInTheDocument();
  // a real recommendation (hit rate) renders, not the "log more" placeholder
  expect(await screen.findByText(/8\/10 succeeded/)).toBeInTheDocument();
  expect(screen.queryByText(/Log at least/)).not.toBeInTheDocument();
});

it('deletes a logged generation (optimistic remove + DELETE call)', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const deletes: string[] = [];
  routeFetch((url, opts) => {
    if (opts?.method === 'DELETE') { deletes.push(url); return { ok: true, status: 200, json: async () => ({ success: true }) }; }
    if (url.includes('briefId=brief_1') && opts?.method !== 'POST') {
      return ok([{ id: 'gen_del', briefId: 'brief_1', verdict: 'failed', engine: 'suno', scores: {}, settings: {}, notes: 'remove me', createdAt: '2026-06-25T00:00:00Z' }]);
    }
    return undefined;
  });

  render(<MusicLab />);
  fireEvent.change(await screen.findByLabelText('Brief'), { target: { value: 'brief_1' } });
  expect(await screen.findByText('remove me')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /delete generation/i }));
  await waitFor(() => expect(deletes).toHaveLength(1));
  expect(deletes[0]).toContain('/api/admin/generations/gen_del?briefId=brief_1');
  await waitFor(() => expect(screen.queryByText('remove me')).not.toBeInTheDocument());
  confirmSpy.mockRestore();
});

it('shows measured audio metrics + a streaming-loudness badge on a take', async () => {
  routeFetch((url, opts) => {
    if (url.includes('briefId=brief_1') && opts?.method !== 'POST') {
      return ok([{
        id: 'gen_m', briefId: 'brief_1', verdict: 'success', engine: 'suno', scores: {}, settings: {},
        createdAt: '2026-06-29T00:00:00Z',
        audioMetrics: { durationSec: 180, peakDbfs: -0.8, rmsDbfs: -12, crestDb: 11.2, clipPct: 0, lufsIntegrated: -11 },
      }]);
    }
    return undefined;
  });
  render(<MusicLab />);
  fireEvent.change(await screen.findByLabelText('Brief'), { target: { value: 'brief_1' } });
  expect(await screen.findByText(/LUFS/)).toBeInTheDocument();
  expect(screen.getByText(/11\.2/)).toBeInTheDocument();          // crest
  expect(screen.getByText(/\+3 LU hot/)).toBeInTheDocument();     // −11 vs −14 norm
});

it('renders server-measured loudness (badge + verdict) on a take', async () => {
  routeFetch((url, opts) => {
    if (url.includes('briefId=brief_1') && opts?.method !== 'POST') {
      return ok([{
        id: 'gen_l', briefId: 'brief_1', verdict: 'success', engine: 'suno', scores: {}, settings: {},
        createdAt: '2026-06-30T00:00:00Z',
        loudness: { lufs: -11, lra: 5, truePeak: -0.4, crest: 8, flatFactor: 0, badge: '+3 LU hot', verdict: 'clip-risk' },
      }]);
    }
    return undefined;
  });
  render(<MusicLab />);
  fireEvent.change(await screen.findByLabelText('Brief'), { target: { value: 'brief_1' } });
  expect(await screen.findByText(/LUFS/)).toBeInTheDocument();
  expect(screen.getByText('+3 LU hot')).toBeInTheDocument();   // server badge
  expect(screen.getByText(/clip-risk/)).toBeInTheDocument();   // server verdict
});

it('flags a truncated insights feed so the stats aren’t silently understated', async () => {
  routeFetch((url, opts) => {
    if (url.startsWith('/api/admin/generations') && (!opts || opts.method !== 'POST') && !url.includes('briefId')) {
      return ok([{ id: 's0', briefId: 'brief_1', verdict: 'success', engine: 'suno', scores: {}, settings: {} }], { truncated: true });
    }
    return undefined;
  });
  render(<MusicLab />);
  expect(await screen.findByText(/Showing the most recent/i)).toBeInTheDocument();
});

it('restores the card (and shows an error) when the delete fails', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  routeFetch((url, opts) => {
    if (opts?.method === 'DELETE') return { ok: false, status: 502, json: async () => ({ success: false, error: 'delete failed' }) };
    if (url.includes('briefId=brief_1') && opts?.method !== 'POST') {
      return ok([{ id: 'gen_keep', briefId: 'brief_1', verdict: 'failed', engine: 'suno', scores: {}, settings: {}, notes: 'keep me', createdAt: '2026-06-25T00:00:00Z' }]);
    }
    return undefined;
  });

  render(<MusicLab />);
  fireEvent.change(await screen.findByLabelText('Brief'), { target: { value: 'brief_1' } });
  expect(await screen.findByText('keep me')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /delete generation/i }));
  // Failed delete → the error surfaces and the card is restored, not lost.
  expect(await screen.findByRole('alert')).toHaveTextContent(/delete failed/i);
  expect(screen.getByText('keep me')).toBeInTheDocument();
  confirmSpy.mockRestore();
});

it('logs the take WITHOUT loudness when the measure-fn payload is malformed (best-effort)', async () => {
  const posted: RequestInit[] = [];
  routeFetch((url, opts) => {
    if (url === '/api/admin/music-lab/measure' && opts?.method === 'POST') {
      // metrics missing required fields (lra, flatFactor) — must be dropped, not
      // ridden along into the save (which the server would 400 on).
      return { ok: true, status: 200, json: async () => ({ success: true, metrics: { lufs: -11, truePeak: -0.5, crest: 8 }, badge: 'x', verdict: 'ok' }) };
    }
    if (url === '/api/admin/generations' && opts?.method === 'POST') {
      posted.push(opts);
      const body = JSON.parse(opts.body as string);
      return { ok: true, status: 201, json: async () => ({ success: true, data: { ...body, id: 'gen_b', createdAt: '2026-07-01T00:00:00.000Z' } }) };
    }
    return undefined;
  });

  await selectBrief();
  fireEvent.change(screen.getByTestId('media-upload'), { target: { value: 'https://cdn.example.com/audio/take.mp3' } });
  fireEvent.click(screen.getByRole('button', { name: /log generation/i }));

  await waitFor(() => expect(posted).toHaveLength(1));
  const body = JSON.parse(posted[0].body as string);
  expect(body.loudness).toBeUndefined();                                   // malformed measurement dropped
  expect(body.audioUrl).toBe('https://cdn.example.com/audio/take.mp3');    // take still logged
});

it('attaches server-measured loudness to the POST when the measure-fn payload is valid', async () => {
  const posted: RequestInit[] = [];
  routeFetch((url, opts) => {
    if (url === '/api/admin/music-lab/measure' && opts?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ success: true, metrics: { lufs: -11, lra: 5, truePeak: -0.4, crest: 8, flatFactor: 0 }, badge: '+3 LU hot', verdict: 'clip-risk' }) };
    }
    if (url === '/api/admin/generations' && opts?.method === 'POST') {
      posted.push(opts);
      const body = JSON.parse(opts.body as string);
      return { ok: true, status: 201, json: async () => ({ success: true, data: { ...body, id: 'gen_v', createdAt: '2026-07-01T00:00:00.000Z' } }) };
    }
    return undefined;
  });

  await selectBrief();
  fireEvent.change(screen.getByTestId('media-upload'), { target: { value: 'https://cdn.example.com/audio/take.mp3' } });
  fireEvent.click(screen.getByRole('button', { name: /log generation/i }));

  await waitFor(() => expect(posted).toHaveLength(1));
  const body = JSON.parse(posted[0].body as string);
  expect(body.loudness).toMatchObject({ lufs: -11, badge: '+3 LU hot', verdict: 'clip-risk' });
});
