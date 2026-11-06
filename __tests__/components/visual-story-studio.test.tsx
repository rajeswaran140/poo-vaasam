/** @jest-environment jsdom */
/**
 * COMPONENT TESTS — Visual Story Studio page (/admin/visual-story/[vsId]):
 * shot cards with STILL generation, the confirm-before-spend dialog, the
 * storyboard draft panel, the spend bar and the tiling indicator.
 */
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Studio } from '@/components/admin/visual-story/Studio';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
import { __resetPlayUrlCacheForTests } from '@/components/admin/visual-story/ui-utils';
// Preview links are cached per file across the page; start each test clean.
beforeEach(() => __resetPlayUrlCacheForTests());
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn() }));
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
const mockFetch = adminFetch as jest.Mock;
const mockPut = putToS3 as jest.Mock;

const VS = 'vs_1730000000000_abcdef12';
const CH = 'ch_1730000000000_abcdef12';
const CD = 'cd_1730000000000_abcdef12';

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const shot = (sceneOrder: number, shotOrder: number, durationSec: number, startSec: number, over = {}) => ({
  sceneOrder, shotOrder, mode: 'STILL', durationSec, startSec,
  visualPrompt: `Prompt ${sceneOrder}.${shotOrder}`, negativePrompt: '', charIds: [] as string[],
  selectedCandidateId: null as string | null, ...over,
});

function tree(over: { spentUsd?: number; reservedUsd?: number } = {}) {
  const spentUsd = over.spentUsd ?? 0.42;
  const reservedUsd = over.reservedUsd ?? 0;
  return {
    story: {
      vsId: VS, masterJobId: 'job-1', audioKey: 'audio/x.wav', contentId: null, title: 'Test song',
      status: 'DRAFT', aspectRatio: '16:9', providerId: 'grok', windowStartSec: 0, windowEndSec: 60,
      budgetUsdCap: 40, spentUsd, reservedUsd, committedUsd: spentUsd + reservedUsd,
      createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    },
    scenes: [{ order: 1, heading: 'Scene 1', summary: 'Opening' }],
    // 30 + 28 = 58 s against a 60 s window.
    shots: [shot(1, 1, 30, 0, { charIds: [CH] }), shot(1, 2, 28, 30)],
    characters: [{ charId: CH, name: 'Hero', description: 'A traveller', refImageKeys: [], createdAt: '2026-11-01' }],
    candidates: [] as unknown[],
    drafts: [] as unknown[],
  };
}

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response | undefined;

/** Route adminFetch: the tree on GET, signed preview URLs, plus per-test overrides. */
function routes(handler: Handler = () => undefined, getTree = () => tree()) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const hit = await handler(url, init);
    if (hit) return hit;
    if (url.startsWith('/api/admin/mastering/download')) return json({ success: true, url: 'https://signed.example/img' });
    if (url === `/api/admin/visual-story/${VS}` && (!init || !init.method || init.method === 'GET')) {
      return json({ success: true, data: getTree() });
    }
    return json({ success: false, error: `unexpected ${url}` }, 500);
  });
}

const calls = (suffix: string) => mockFetch.mock.calls.filter(([u]) => String(u).endsWith(suffix));
const treeLoads = () => mockFetch.mock.calls.filter(([u, i]) => u === `/api/admin/visual-story/${VS}` && !i?.method);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockPut.mockReset();
  mockPush.mockReset();
});

async function card(label: string) {
  return screen.findByRole('article', { name: label });
}

describe('Studio — shot cards', () => {
  it('shows the real clip price (not a per-mode estimate), prompt, character chip and m:ss span', async () => {
    routes();
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.2');
    // Every clip is made at the $0.08/s video rate, whatever the shot's mode: 28 s = $2.24.
    expect(within(c).getByText('28 s · clip $2.24')).toBeInTheDocument();
    expect(within(c).queryByText('STILL')).not.toBeInTheDocument();
    expect(c).not.toHaveTextContent(/estimate/);
    expect(within(c).getByText('Prompt 1.2')).toBeInTheDocument();
    expect(within(c).getByText('0:30–0:58')).toBeInTheDocument();
    expect(within(await card('Shot 1.1')).getByText('Hero')).toBeInTheDocument();
  });

  it('confirm dialog shows the price and the story total after this call', async () => {
    routes();
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('button', { name: 'Generate still ($0.02)' }));
    const dialog = within(c).getByRole('dialog');
    expect(dialog).toHaveTextContent('$0.02');
    expect(dialog).toHaveTextContent('Story total after this: $0.44 of $40.00');
    expect(calls('/still')).toHaveLength(0);
  });

  it('renders a 422 content-policy error inside that shot card, not in a page banner', async () => {
    const msg = 'The image was refused by the content policy.';
    routes((url) => (url.endsWith('/still') ? json({ success: false, error: msg }, 422) : undefined));
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('button', { name: 'Generate still ($0.02)' }));
    fireEvent.click(within(c).getByRole('button', { name: 'Confirm' }));
    expect(await within(c).findByText(msg)).toBeInTheDocument();
    expect(screen.getAllByText(msg)).toHaveLength(1);
    expect(within(await card('Shot 1.2')).queryByText(msg)).not.toBeInTheDocument();
    expect(calls(`/shots/001-001/still`)).toHaveLength(1);
  });

  it('disables Generate while the request is in flight; a second click sends nothing', async () => {
    const pending = deferred<Response>();
    routes((url) => (url.endsWith('/still') ? pending.promise : undefined));
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    const generate = within(c).getByRole('button', { name: /Generate still/ });
    fireEvent.click(generate);
    fireEvent.click(within(c).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(within(c).getByRole('button', { name: /Generat/ })).toBeDisabled());
    fireEvent.click(within(c).getByRole('button', { name: /Generat/ }));
    expect(within(c).queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls('/still')).toHaveLength(1);
    pending.resolve(json({ success: true, data: { candidate: {} } }, 201));
    await waitFor(() => expect(within(c).getByRole('button', { name: /Generate still/ })).toBeEnabled());
    expect(calls('/still')).toHaveLength(1);
  });

  it('two Confirm clicks in the same tick send one still request', async () => {
    const pending = deferred<Response>();
    routes((url) => (url.endsWith('/still') ? pending.promise : undefined));
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('button', { name: /Generate still/ }));
    const confirm = within(c).getByRole('button', { name: 'Confirm' });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(calls('/still')).toHaveLength(1);
    await act(async () => pending.resolve(json({ success: true, data: { candidate: {} } }, 201)));
    expect(calls('/still')).toHaveLength(1);
  });

  it('reloads the tree after a generation so spend updates', async () => {
    let spent = 0.42;
    routes(
      (url) => {
        if (!url.endsWith('/still')) return undefined;
        spent = 0.44;
        return json({ success: true, data: { candidate: {} } }, 201);
      },
      () => tree({ spentUsd: spent })
    );
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    expect(screen.getByText('$0.42 spent + $0.00 reserved of $40.00')).toBeInTheDocument();
    fireEvent.click(within(c).getByRole('button', { name: /Generate still/ }));
    fireEvent.click(within(c).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('$0.44 spent + $0.00 reserved of $40.00')).toBeInTheDocument();
    expect(treeLoads().length).toBeGreaterThanOrEqual(2);
  });

  it('selects a candidate with its radio', async () => {
    const t = tree();
    t.candidates = [{ candId: CD, sceneOrder: 1, shotOrder: 1, jobId: null, providerId: 'grok-image', providerTaskId: null, mode: 'STILL', s3Key: `audio/mastering/visual-story/${VS}/candidates/${CD}.jpg`, costUsd: 0.02, createdAt: '2026-11-01' }];
    routes((url) => (url.endsWith('/select') ? json({ success: true, data: {} }) : undefined), () => t);
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('radio', { name: /Image 1/ }));
    await waitFor(() => expect(calls('/select')).toHaveLength(1));
    expect(JSON.parse(calls('/select')[0][1].body)).toEqual({ sceneOrder: 1, shotOrder: 1, candId: CD });
  });
});

describe('Studio — spend and tiling', () => {
  it('reads "Shots fill 58 of 60 s" and shows spent + reserved of cap', async () => {
    routes(undefined, () => tree({ spentUsd: 1.5, reservedUsd: 0.15 }));
    render(<Studio vsId={VS} />);
    expect(await screen.findByText('Shots fill 58 of 60 s')).toBeInTheDocument();
    expect(screen.getByText('$1.50 spent + $0.15 reserved of $40.00')).toBeInTheDocument();
  });

  it('says what all the shots would cost as clips, and no longer promises a render', async () => {
    routes();
    render(<Studio vsId={VS} />);
    // 30 + 28 = 58 s × $0.08 = $4.64.
    expect(await screen.findByText('All 2 shots as clips: about $4.64')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Spend and timeline' })).not.toHaveTextContent(/render/);
  });

  it('offers the render panel under the title, and no longer says joining is not built', async () => {
    routes();
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    expect(screen.getByRole('region', { name: 'Render video' })).toBeInTheDocument();
    expect(screen.queryByText(/not built yet/)).toBeNull();
  });

  it('over the cap, the still dialog offers "Raise budget", which focuses the Budget field', async () => {
    routes(undefined, () => tree({ spentUsd: 39.99 }));
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('button', { name: 'Generate still ($0.02)' }));
    fireEvent.click(within(within(c).getByRole('dialog')).getByRole('button', { name: 'Raise budget' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Budget (USD)'));
  });
});

describe('Studio — draft panel', () => {
  const draft = {
    draftId: 'dr_1730000000000_abcdef12', lyricsHash: 'h', model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0.01,
    characters: [{ name: 'Hero', description: 'A traveller' }],
    scenes: [{ heading: 'Scene 1', summary: 'Opening', shots: [
      { durationSec: 30, mode: 'STILL', visualPrompt: 'Draft shot one', characterNames: ['Hero'] },
      { durationSec: 30, mode: 'STILL', visualPrompt: 'Draft shot two', characterNames: [] },
    ] }],
    createdAt: '2026-11-01',
  };

  const JOB = 'dj_1730000000000_abcdef12';
  const jobUrl = `/api/admin/visual-story/${VS}/draft/jobs/${JOB}`;

  async function drafted() {
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.change(screen.getByLabelText(/^Lyrics$/), { target: { value: 'Line one\nLine two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft storyboard (≈$0.15)' }));
  }

  /** The draft runs on the worker (R14): POST → 202 {jobId}, then the job route; the tree carries the draft once done. */
  function draftJob(opts: { polls?: Response[]; saves?: boolean; apply?: () => Promise<Response> | Response } = {}) {
    let done = false; // the worker saves the draft when the job finishes
    const polls = [...(opts.polls ?? [json({ success: true, status: 'done', result: { draftId: draft.draftId } })])];
    routes(
      (url, init) => {
        if (url.endsWith('/draft') && init?.method === 'POST') return json({ success: true, data: { jobId: JOB } }, 202);
        if (url === jobUrl) {
          if (polls.length > 1) return polls.shift()!;
          done = opts.saves ?? true;
          return polls[0];
        }
        if (url.endsWith('/apply')) return opts.apply ? opts.apply() : json({ success: true, data: tree() });
        return undefined;
      },
      () => {
        const t = tree();
        if (done) t.drafts = [draft];
        return t;
      }
    );
  }

  it('POSTs the lyrics, polls the job, reloads the tree and shows the new draft; then Apply replaces', async () => {
    draftJob();
    await drafted();
    expect(await screen.findByText('New draft')).toBeInTheDocument();
    expect(screen.getByText('Draft shot one')).toBeInTheDocument();
    expect(screen.getByText('Draft fills 60 of 60 s')).toBeInTheDocument();
    expect(JSON.parse(calls('/draft')[0][1].body)).toEqual({ lyrics: 'Line one\nLine two' });
    expect(mockFetch.mock.calls.filter(([u]) => u === jobUrl).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/replaces the current storyboard/i)).toBeInTheDocument();
    expect(calls('/apply')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Replace storyboard' }));
    await waitFor(() => expect(calls(`/draft/${draft.draftId}/apply`)).toHaveLength(1));
  });

  it('while the job runs: "about a minute" copy, the button stays disabled, a second click sends nothing', async () => {
    jest.useFakeTimers();
    try {
      draftJob({
        polls: [json({ success: true, status: 'running' }), json({ success: true, status: 'done', result: { draftId: draft.draftId } })],
      });
      await drafted();
      expect(await screen.findByText('Drafting… this takes about a minute.')).toBeInTheDocument();
      const button = screen.getByRole('button', { name: 'Drafting…' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(calls('/draft')).toHaveLength(1);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(await screen.findByText('Draft shot one')).toBeInTheDocument();
      expect(screen.queryByText('Drafting… this takes about a minute.')).not.toBeInTheDocument();
      expect(calls('/draft')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failed job shows its error inside the draft panel and reloads spend', async () => {
    const msg = 'The AI service is rate-limited right now. Please retry in a moment.';
    draftJob({ polls: [json({ success: true, status: 'error', error: { code: 'rate_limit', message: msg } })], saves: false });
    await drafted();
    const panel = screen.getByRole('region', { name: 'Storyboard draft' });
    expect(await within(panel).findByText(msg)).toBeInTheDocument();
    expect(screen.getAllByText(msg)).toHaveLength(1);
    await waitFor(() => expect(treeLoads().length).toBeGreaterThanOrEqual(2));
    expect(screen.getByRole('button', { name: 'Draft storyboard (≈$0.15)' })).not.toBeDisabled();
  });

  it('two Replace clicks in the same tick send one apply request', async () => {
    const pending = deferred<Response>();
    draftJob({ apply: () => pending.promise });
    await drafted();
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    const replace = screen.getByRole('button', { name: 'Replace storyboard' });
    act(() => {
      replace.click();
      replace.click();
    });
    expect(calls('/apply')).toHaveLength(1);
    await act(async () => pending.resolve(json({ success: true, data: tree() })));
    expect(calls('/apply')).toHaveLength(1);
  });

  it('shows the newest persisted draft on load, dated, and applies it without a new draft call', async () => {
    const older = { ...draft, draftId: 'dr_1730000000000_olddraft1', createdAt: '2026-11-01T08:00:00Z',
      scenes: [{ heading: 'Old scene', summary: '', shots: [{ durationSec: 60, mode: 'STILL', visualPrompt: 'Old draft shot', characterNames: [] }] }] };
    const newer = { ...draft, draftId: 'dr_1730000000000_newdraft1', createdAt: '2026-11-03T08:00:00Z' };
    const t = tree();
    t.drafts = [newer, older];
    routes((url) => (url.endsWith('/apply') ? json({ success: true, data: tree() }) : undefined), () => t);
    render(<Studio vsId={VS} />);
    const panel = await screen.findByRole('region', { name: 'Storyboard draft' });
    expect(within(panel).getByText('Draft shot one')).toBeInTheDocument();
    expect(within(panel).queryByText('Old draft shot')).not.toBeInTheDocument();
    expect(within(panel).getByText(/^Last draft \(.+\)$/)).toBeInTheDocument();
    expect(calls('/draft')).toHaveLength(0);
    fireEvent.click(within(panel).getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Replace storyboard' }));
    await waitFor(() => expect(calls(`/draft/${newer.draftId}/apply`)).toHaveLength(1));
    // Once applied in this session it is not offered again as a draft to apply.
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument());
  });

  it('shows a draft error inside the draft panel', async () => {
    const msg = "This would go over the story's budget ($39.90 of $40.00).";
    routes((url) => (url.endsWith('/draft') ? json({ success: false, error: msg }, 402) : undefined));
    await drafted();
    const panel = screen.getByRole('region', { name: 'Storyboard draft' });
    expect(await within(panel).findByText(msg)).toBeInTheDocument();
    expect(screen.getAllByText(msg)).toHaveLength(1);
  });
});

describe('Studio — characters', () => {
  it('uploads a reference: presign, POST to S3, confirm', async () => {
    const key = `audio/mastering/visual-story/${VS}/refs/${CH}/x.png`;
    routes((url, init) => {
      if (!url.endsWith('/upload')) return undefined;
      const op = JSON.parse(String(init?.body)).op;
      if (op === 'presign') return json({ success: true, uploadUrl: 'https://s3.example', fields: { a: 'b' }, key });
      if (op === 'confirm') return json({ success: true, data: { character: {} } });
      return undefined;
    });
    mockPut.mockResolvedValue(undefined);
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.click(screen.getByRole('tab', { name: 'Characters' }));
    const file = new File(['x'], 'ref.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload a reference for Hero'), { target: { files: [file] } });
    await waitFor(() => expect(calls('/upload')).toHaveLength(2));
    const [presign, confirm] = calls('/upload').map(([, i]) => JSON.parse(i.body));
    expect(presign).toEqual({ op: 'presign', contentType: 'image/png', size: 1 });
    expect(mockPut).toHaveBeenCalledWith('https://s3.example', { a: 'b' }, file, expect.any(Function), expect.anything());
    expect(confirm).toEqual({ op: 'confirm', key });
  });
});

describe('Studio — undo and budget (I1)', () => {
  it('Delete shot (Inspector) asks first, says its stills go too, then deletes and reloads', async () => {
    routes((url) => (url.endsWith('/shots') ? json({ success: true, data: {} }) : undefined));
    render(<Studio vsId={VS} />);
    fireEvent.click(within(await card('Shot 1.2')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit shot 1.2' });
    fireEvent.click(within(form).getByRole('button', { name: 'Delete shot' }));
    const confirm = within(form).getByRole('alertdialog', { name: 'Delete this shot?' });
    expect(confirm).toHaveTextContent('Delete shot 1.2? Its stills are deleted too. This cannot be undone.');
    expect(calls('/shots')).toHaveLength(0);
    const loadsBefore = treeLoads().length;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls('/shots')).toHaveLength(1));
    expect(JSON.parse(calls('/shots')[0][1].body)).toEqual({ op: 'delete', sceneOrder: 1, shotOrder: 2 });
    await waitFor(() => expect(treeLoads().length).toBeGreaterThan(loadsBefore));
  });

  it('Delete shot can be cancelled; its error renders beside it', async () => {
    routes((url) => (url.endsWith('/shots') ? json({ success: false, error: 'That item no longer exists.' }, 404) : undefined));
    render(<Studio vsId={VS} />);
    fireEvent.click(within(await card('Shot 1.1')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit shot 1.1' });
    fireEvent.click(within(form).getByRole('button', { name: 'Delete shot' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(within(form).queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Delete shot' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Delete' }));
    expect(await within(form).findByText('That item no longer exists.')).toBeInTheDocument();
  });

  it('Delete scene (scene rail) asks first, names its shots and stills, then deletes', async () => {
    routes((url) => (url.endsWith('/scenes') ? json({ success: true, data: {} }) : undefined));
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    const rail = screen.getByRole('navigation', { name: 'Scenes' });
    fireEvent.click(within(rail).getByRole('button', { name: 'Delete scene Scene 1' }));
    const confirm = within(rail).getByRole('alertdialog', { name: 'Delete this scene?' });
    expect(confirm).toHaveTextContent('Delete “Scene 1”, its 2 shots and their stills? This cannot be undone.');
    expect(calls('/scenes')).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls('/scenes')).toHaveLength(1));
    expect(JSON.parse(calls('/scenes')[0][1].body)).toEqual({ op: 'delete', order: 1 });
  });

  it('Budget field PATCHes budgetUsdCap and reloads', async () => {
    routes((url, init) => (url === `/api/admin/visual-story/${VS}` && init?.method === 'PATCH' ? json({ success: true, data: {} }) : undefined));
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    const bar = screen.getByRole('contentinfo', { name: 'Spend and timeline' });
    const input = within(bar).getByLabelText('Budget (USD)');
    expect(input).toHaveValue(40);
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save budget' }));
    await waitFor(() =>
      expect(mockFetch.mock.calls.filter(([u, i]) => u === `/api/admin/visual-story/${VS}` && i?.method === 'PATCH')).toHaveLength(1)
    );
    const [, init] = mockFetch.mock.calls.find(([u, i]) => u === `/api/admin/visual-story/${VS}` && i?.method === 'PATCH')!;
    expect(JSON.parse(init.body)).toEqual({ budgetUsdCap: 55 });
  });

  it('a 409 from the budget route shows next to the field', async () => {
    const msg = "The cap can't go below what's already spent or reserved ($0.42).";
    routes((url, init) => (url === `/api/admin/visual-story/${VS}` && init?.method === 'PATCH' ? json({ success: false, error: msg }, 409) : undefined));
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    const bar = screen.getByRole('contentinfo', { name: 'Spend and timeline' });
    fireEvent.change(within(bar).getByLabelText('Budget (USD)'), { target: { value: '0.1' } });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save budget' }));
    expect(await within(bar).findByText(msg)).toBeInTheDocument();
    expect(screen.getAllByText(msg)).toHaveLength(1);
  });
});

describe('Studio — upload your own picture', () => {
  const uploadUrl = `/api/admin/visual-story/${VS}/shots/001-002/upload`;
  const key = `audio/mastering/visual-story/${VS}/candidates/${CD}.png`;

  it('presigns, POSTs the file to S3, confirms on THIS shot, then reloads', async () => {
    routes((url, init) => {
      if (url !== uploadUrl) return undefined;
      const op = JSON.parse(String(init?.body)).op;
      if (op === 'presign') return json({ success: true, uploadUrl: 'https://s3.example', fields: { a: 'b' }, key });
      if (op === 'confirm') return json({ success: true, data: { candidate: {} } }, 201);
      return undefined;
    });
    mockPut.mockResolvedValue(undefined);
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.2');
    expect(c).toHaveTextContent('Upload picture (JPEG or PNG, free)');
    const loadsBefore = treeLoads().length;
    const file = new File(['xy'], 'thumb.png', { type: 'image/png' });
    fireEvent.change(within(c).getByLabelText('Upload a picture for Shot 1.2'), { target: { files: [file] } });
    await waitFor(() => expect(calls('/001-002/upload')).toHaveLength(2));
    const [presign, confirm] = calls('/001-002/upload').map(([, i]) => JSON.parse(i.body));
    expect(presign).toEqual({ op: 'presign', contentType: 'image/png', size: 2 });
    expect(mockPut).toHaveBeenCalledWith('https://s3.example', { a: 'b' }, file, expect.any(Function), expect.anything());
    expect(confirm).toEqual({ op: 'confirm', key });
    await waitFor(() => expect(treeLoads().length).toBeGreaterThan(loadsBefore));
  });

  it('a refused upload shows its reason in the card and never reaches S3', async () => {
    routes((url) => (url === uploadUrl ? json({ success: false, error: 'Upload a JPEG or PNG picture.' }, 400) : undefined));
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.2');
    const file = new File(['x'], 'thumb.webp', { type: 'image/webp' });
    fireEvent.change(within(c).getByLabelText('Upload a picture for Shot 1.2'), { target: { files: [file] } });
    expect(await within(c).findByRole('alert')).toHaveTextContent('Upload a JPEG or PNG picture.');
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('an uploaded picture is labelled "Yours" and can be the first frame', async () => {
    const mine = {
      candId: CD, sceneOrder: 1, shotOrder: 2, jobId: null, providerId: 'upload', providerTaskId: null,
      mode: 'STILL', s3Key: key, costUsd: 0, createdAt: '2026-11-06',
    };
    routes(undefined, () => ({ ...tree(), candidates: [mine] }));
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.2');
    expect(await within(c).findByText('Yours')).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Use as first frame' })).toBeInTheDocument();
  });
});

describe('Studio — video clips', () => {
  const GJ = 'gj_1730000000000_abcdef12';
  const VCD = 'cd_1730000000000_abcdef12'; // candIdForJob(GJ)
  const SCD = 'cd_1730000000000_still0001';
  const videoUrl = `/api/admin/visual-story/${VS}/shots/001-001/video`;
  const jobUrl = `/api/admin/visual-story/${VS}/video-jobs/${GJ}`;
  const STILL_REL = 'Still rendering. Press Check again in a minute.';

  const genJob = (status: string, over = {}) => ({
    jobId: GJ, sceneOrder: 1, shotOrder: 1, status, providerId: 'grok', providerTaskId: 'task-1',
    reservedUsd: 0.48, candId: VCD, attempts: 0, copyFailures: 0, lastPolledAt: null,
    createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z', ...over,
  });
  const stillCand = {
    candId: SCD, sceneOrder: 1, shotOrder: 1, jobId: null, providerId: 'grok-image', providerTaskId: null,
    mode: 'STILL', s3Key: `audio/mastering/visual-story/${VS}/candidates/${SCD}.jpg`, costUsd: 0.02, createdAt: '2026-11-01',
  };
  const videoCand = {
    candId: VCD, sceneOrder: 1, shotOrder: 1, jobId: GJ, providerId: 'grok', providerTaskId: 'task-1',
    mode: 'HERO', s3Key: `audio/mastering/visual-story/${VS}/candidates/${VCD}.mp4`, costUsd: 0.48, createdAt: '2026-11-05',
  };

  /** Shot 1.1 lasts 6 s, so its clip costs 6 × $0.08 = $0.48. */
  function vtree(over: { jobs?: unknown[]; candidates?: unknown[]; firstFrame?: string; spentUsd?: number } = {}) {
    const t = tree({ spentUsd: over.spentUsd });
    t.shots = [
      shot(1, 1, 6, 0, { charIds: [CH], ...(over.firstFrame ? { firstFrameCandidateId: over.firstFrame } : {}) }),
      shot(1, 2, 5, 6),
    ];
    t.candidates = over.candidates ?? [];
    return { ...t, genJobs: over.jobs ?? [] };
  }

  /** POST → 202 {jobId}; each GET of the job route returns the next poll (the last one repeats). */
  function videoRoutes(opts: { polls?: (Response | Error)[]; start?: () => Response | Promise<Response>; cancel?: () => Response; getTree?: () => unknown } = {}) {
    const polls = [...(opts.polls ?? [json({ success: true, data: genJob('running') })])];
    routes(
      (url, init) => {
        if (url === videoUrl && init?.method === 'POST') return opts.start ? opts.start() : json({ success: true, data: { jobId: GJ } }, 202);
        if (url === jobUrl && init?.method === 'POST') return opts.cancel ? opts.cancel() : json({ success: true, data: genJob('cancelled') });
        if (url === jobUrl) {
          const next = polls.length > 1 ? polls.shift()! : polls[0];
          if (next instanceof Error) throw next;
          return next;
        }
        if (url.endsWith('/shots') && init?.method === 'POST') return json({ success: true, data: {} });
        if (url.endsWith('/select')) return json({ success: true, data: {} });
        return undefined;
      },
      (opts.getTree ?? (() => vtree())) as () => ReturnType<typeof tree>
    );
  }

  const polls = () => mockFetch.mock.calls.filter(([u, i]) => u === jobUrl && !i?.method);

  async function startVideo(c: HTMLElement) {
    fireEvent.click(within(c).getByRole('button', { name: 'Make video (6 s · $0.48)' }));
    fireEvent.click(within(within(c).getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
  }

  it('confirm shows the $0.48 price and the story total after this call; nothing is sent yet', async () => {
    videoRoutes();
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('button', { name: 'Make video (6 s · $0.48)' }));
    const dialog = within(c).getByRole('dialog');
    expect(dialog).toHaveTextContent('$0.48');
    expect(dialog).toHaveTextContent('Story total after this: $0.90 of $40.00');
    expect(calls('/video')).toHaveLength(0);
  });

  it('after Confirm the card shows "Rendering…", the button is disabled and a second click sends nothing', async () => {
    videoRoutes();
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    await startVideo(c);
    expect(await within(c).findByText('Rendering… about 1–3 minutes')).toBeInTheDocument();
    const button = within(c).getByRole('button', { name: /Rendering…|Make video/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(within(c).queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls('/video')).toHaveLength(1);
    expect(calls('/shots/001-001/video')[0][1].method).toBe('POST');
  });

  it('two Confirm clicks in the same tick start one video', async () => {
    const pending = deferred<Response>();
    videoRoutes({ start: () => pending.promise });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('button', { name: 'Make video (6 s · $0.48)' }));
    const confirm = within(within(c).getByRole('dialog')).getByRole('button', { name: 'Confirm' });
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(calls('/video')).toHaveLength(1);
    await act(async () => pending.resolve(json({ success: true, data: { jobId: GJ } }, 202)));
    expect(calls('/video')).toHaveLength(1);
  });

  it('polls the job every 5 s and reloads the tree when the clip is done', async () => {
    jest.useFakeTimers();
    try {
      let done = false;
      videoRoutes({
        polls: [json({ success: true, data: genJob('running') }), json({ success: true, data: genJob('succeeded') })],
        getTree: () => (done ? vtree({ jobs: [genJob('succeeded')], candidates: [videoCand] }) : vtree()),
      });
      render(<Studio vsId={VS} />);
      const c = await card('Shot 1.1');
      await startVideo(c);
      expect(await within(c).findByText('Rendering… about 1–3 minutes')).toBeInTheDocument();
      await waitFor(() => expect(polls()).toHaveLength(1));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });
      expect(polls()).toHaveLength(1);
      done = true;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
      expect(polls()).toHaveLength(2);
      await waitFor(() => expect(within(c).queryByText('Rendering… about 1–3 minutes')).not.toBeInTheDocument());
      expect(within(c).getByRole('button', { name: 'Make video (6 s · $0.48)' })).toBeEnabled();
      expect(c.querySelector('video')).not.toBeNull();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20_000);
      });
      expect(polls()).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a running job in the loaded tree resumes polling and keeps the button disabled', async () => {
    videoRoutes({ getTree: () => vtree({ jobs: [genJob('running')] }) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    expect(await within(c).findByText('Rendering… about 1–3 minutes')).toBeInTheDocument();
    await waitFor(() => expect(polls().length).toBeGreaterThanOrEqual(1));
    expect(calls('/video')).toHaveLength(0);
    expect(within(c).getByRole('button', { name: /Rendering…|Make video/ })).toBeDisabled();
    // Only the shot with the job is busy.
    expect(within(await card('Shot 1.2')).getByRole('button', { name: /Make video/ })).toBeEnabled();
  });

  it("a failed job's message renders inside that shot's card", async () => {
    const msg = 'Grok refused this clip under its content policy.';
    videoRoutes({
      polls: [json({ success: true, data: genJob('failed', { code: 'content_policy', error: msg }) })],
    });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    await startVideo(c);
    expect(await within(c).findByText(msg)).toBeInTheDocument();
    expect(screen.getAllByText(msg)).toHaveLength(1);
    expect(within(await card('Shot 1.2')).queryByText(msg)).not.toBeInTheDocument();
    await waitFor(() => expect(within(c).getByRole('button', { name: 'Make video (6 s · $0.48)' })).toBeEnabled());
  });

  it('a 402 from the make-video route renders inside the card', async () => {
    const msg = "This would go over the story's budget ($40.10 of $40.00).";
    videoRoutes({ start: () => json({ success: false, error: msg }, 402) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    await startVideo(c);
    expect(await within(c).findByText(msg)).toBeInTheDocument();
    expect(screen.getAllByText(msg)).toHaveLength(1);
    expect(polls()).toHaveLength(0);
    fireEvent.click(within(c).getByRole('button', { name: 'Raise budget' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Budget (USD)'));
  });

  it('over the cap, the video dialog offers "Raise budget" too', async () => {
    videoRoutes({ getTree: () => vtree({ spentUsd: 39.9 }) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(within(c).getByRole('button', { name: /Make video/ }));
    const dialog = within(c).getByRole('dialog', { name: 'Confirm video for Shot 1.1' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Raise budget' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Budget (USD)'));
  });

  it('after 15 minutes it stops polling and points at "Check rendering videos"', async () => {
    jest.useFakeTimers();
    try {
      videoRoutes({ getTree: () => vtree({ jobs: [genJob('running')] }) });
      render(<Studio vsId={VS} />);
      const c = await card('Shot 1.1');
      await waitFor(() => expect(polls()).toHaveLength(1));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(15 * 60_000 + 5000);
      });
      expect(await within(c).findByText(STILL_REL)).toBeInTheDocument();
      const n = polls().length;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(polls()).toHaveLength(n);
      expect(within(c).getByRole('button', { name: /Rendering…|Make video/ })).toBeDisabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('Cancel asks first (Grok may still charge), then POSTs op:cancel and reloads', async () => {
    videoRoutes({ getTree: () => vtree({ jobs: [genJob('running')] }) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    await within(c).findByText('Rendering… about 1–3 minutes');
    fireEvent.click(within(c).getByRole('button', { name: 'Cancel' }));
    const confirm = within(c).getByRole('alertdialog');
    expect(confirm).toHaveTextContent("Grok may still charge for this clip, and it won't be kept.");
    expect(mockFetch.mock.calls.filter(([u, i]) => u === jobUrl && i?.method === 'POST')).toHaveLength(0);
    const loadsBefore = treeLoads().length;
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel video' }));
    await waitFor(() => expect(mockFetch.mock.calls.filter(([u, i]) => u === jobUrl && i?.method === 'POST')).toHaveLength(1));
    const [, init] = mockFetch.mock.calls.find(([u, i]) => u === jobUrl && i?.method === 'POST')!;
    expect(JSON.parse(init.body)).toEqual({ op: 'cancel' });
    expect(init.signal).toBeUndefined();
    await waitFor(() => expect(treeLoads().length).toBeGreaterThan(loadsBefore));
  });

  it('stops polling on unmount', async () => {
    jest.useFakeTimers();
    try {
      videoRoutes({ getTree: () => vtree({ jobs: [genJob('running')] }) });
      const { unmount } = render(<Studio vsId={VS} />);
      await card('Shot 1.1');
      await waitFor(() => expect(polls()).toHaveLength(1));
      unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(30_000);
      });
      expect(polls()).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('video candidates render a muted inline <video> with a "Video" badge and can be selected', async () => {
    videoRoutes({ getTree: () => vtree({ candidates: [stillCand, videoCand] }) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    await waitFor(() => expect(c.querySelector('video')).not.toBeNull());
    const video = c.querySelector('video') as HTMLVideoElement;
    await waitFor(() => expect(video).toHaveAttribute('src', 'https://signed.example/img'));
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('playsinline');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(video.muted).toBe(true);
    expect(within(c).getByText('Video')).toBeInTheDocument();
    expect(within(c).getByText('Still')).toBeInTheDocument();
    fireEvent.click(within(c).getByRole('radio', { name: 'Video 2' }));
    await waitFor(() => expect(calls('/select')).toHaveLength(1));
    expect(JSON.parse(calls('/select')[0][1].body)).toEqual({ sceneOrder: 1, shotOrder: 1, candId: VCD });
  });

  it('"Use as first frame" is offered on stills only and POSTs the shot update', async () => {
    videoRoutes({ getTree: () => vtree({ candidates: [stillCand, videoCand] }) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    const buttons = within(c).getAllByRole('button', { name: 'Use as first frame' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(calls('/shots')).toHaveLength(1));
    expect(JSON.parse(calls('/shots')[0][1].body)).toEqual({ op: 'update', sceneOrder: 1, shotOrder: 1, firstFrameCandidateId: SCD });
  });

  it('the pinned still reads "First frame" on the card; the Inspector shows it with Clear', async () => {
    videoRoutes({ getTree: () => vtree({ candidates: [stillCand], firstFrame: SCD }) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    expect(within(c).getByText('First frame')).toBeInTheDocument();
    expect(within(c).queryByRole('button', { name: 'Use as first frame' })).not.toBeInTheDocument();
    fireEvent.click(within(c).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit shot 1.1' });
    expect(await within(form).findByRole('img', { name: 'First frame for shot 1.1' })).toBeInTheDocument();
    expect(form).toHaveTextContent(/character photos are used for video clips/i);
    expect(form).toHaveTextContent(/720p/);
    fireEvent.click(within(form).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(calls('/shots')).toHaveLength(1));
    expect(JSON.parse(calls('/shots')[0][1].body)).toEqual({ op: 'update', sceneOrder: 1, shotOrder: 1, firstFrameCandidateId: null });
  });

  it('a pinned id that no longer resolves does not crash the Inspector and can be cleared', async () => {
    videoRoutes({ getTree: () => vtree({ candidates: [], firstFrame: 'cd_1730000000000_gone0001' }) });
    render(<Studio vsId={VS} />);
    fireEvent.click(within(await card('Shot 1.1')).getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit shot 1.1' });
    expect(within(form).queryByRole('img', { name: 'First frame for shot 1.1' })).not.toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(calls('/shots')).toHaveLength(1));
    expect(JSON.parse(calls('/shots')[0][1].body).firstFrameCandidateId).toBeNull();
  });

  it('a 5xx poll is transient: it keeps polling, then finishes with no error shown', async () => {
    jest.useFakeTimers();
    try {
      videoRoutes({
        polls: [json({ success: false, error: 'Gateway timeout' }, 504), json({ success: true, data: genJob('succeeded') })],
      });
      render(<Studio vsId={VS} />);
      const c = await card('Shot 1.1');
      await startVideo(c);
      await waitFor(() => expect(polls()).toHaveLength(1));
      expect(within(c).getByText('Rendering… about 1–3 minutes')).toBeInTheDocument();
      expect(within(c).queryByRole('alert')).not.toBeInTheDocument();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(polls()).toHaveLength(2);
      await waitFor(() => expect(within(c).queryByText('Rendering… about 1–3 minutes')).not.toBeInTheDocument());
      expect(within(c).queryByRole('alert')).not.toBeInTheDocument();
      expect(within(c).queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a network failure mid-render keeps polling', async () => {
    jest.useFakeTimers();
    try {
      videoRoutes({
        polls: [new TypeError('Failed to fetch'), json({ success: true, data: genJob('running') }), json({ success: true, data: genJob('succeeded') })],
        getTree: () => vtree({ jobs: [genJob('running')] }),
      });
      render(<Studio vsId={VS} />);
      const c = await card('Shot 1.1');
      await waitFor(() => expect(polls()).toHaveLength(1));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(polls()).toHaveLength(2);
      expect(within(c).getByText('Rendering… about 1–3 minutes')).toBeInTheDocument();
      expect(within(c).queryByRole('alert')).not.toBeInTheDocument();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      expect(polls()).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a 4xx poll stops with a message in the card and "Check again" restarts polling', async () => {
    const msg = 'That video no longer exists.';
    videoRoutes({
      polls: [json({ success: false, error: msg }, 404), json({ success: true, data: genJob('running') })],
      getTree: () => vtree({ jobs: [genJob('running')] }),
    });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    expect(await within(c).findByText(msg)).toBeInTheDocument();
    expect(screen.getAllByText(msg)).toHaveLength(1);
    expect(polls()).toHaveLength(1);
    fireEvent.click(within(c).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(polls()).toHaveLength(2));
    await waitFor(() => expect(within(c).queryByText(msg)).not.toBeInTheDocument());
    expect(within(c).queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    expect(within(c).getByText('Rendering… about 1–3 minutes')).toBeInTheDocument();
  });

  it('after the 15-minute cap "Check again" restarts polling', async () => {
    jest.useFakeTimers();
    try {
      videoRoutes({ getTree: () => vtree({ jobs: [genJob('running')] }) });
      render(<Studio vsId={VS} />);
      const c = await card('Shot 1.1');
      await waitFor(() => expect(polls()).toHaveLength(1));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(15 * 60_000 + 5000);
      });
      expect(await within(c).findByText(STILL_REL)).toBeInTheDocument();
      const n = polls().length;
      fireEvent.click(within(c).getByRole('button', { name: 'Check again' }));
      await waitFor(() => expect(polls()).toHaveLength(n + 1));
    } finally {
      jest.useRealTimers();
    }
  });

  it('a failed job found on load reads "Last clip failed: …" inside its card', async () => {
    const msg = 'Grok refused this clip under its content policy.';
    videoRoutes({ getTree: () => vtree({ jobs: [genJob('failed', { code: 'content_policy', error: msg })] }) });
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    expect(within(c).getByText(`Last clip failed: ${msg}`)).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Make video (6 s · $0.48)' })).toBeEnabled();
    expect(polls()).toHaveLength(0);
  });

  it('the characters panel says reference photos are used for video clips', async () => {
    videoRoutes();
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.click(screen.getByRole('tab', { name: 'Characters' }));
    expect(screen.getByText(/reference photos are used for video clips/i)).toBeInTheDocument();
  });
});

describe('Studio — phone layout and flow (audit PR 2)', () => {
  const still = (candId: string, shotOrder = 1) => ({
    candId, sceneOrder: 1, shotOrder, jobId: null, providerId: 'grok-image', providerTaskId: null, mode: 'STILL',
    s3Key: `audio/mastering/visual-story/${VS}/candidates/${candId}.jpg`, costUsd: 0.02, createdAt: '2026-11-01',
  });
  const setPhone = (phone: boolean) => {
    window.matchMedia = jest.fn().mockImplementation((q: string) => ({ matches: phone, media: q })) as never;
  };
  let scrolled: jest.Mock;
  beforeEach(() => {
    scrolled = jest.fn();
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('on a phone, Edit brings the shot panel into view, every time it is pressed', async () => {
    setPhone(true);
    routes();
    render(<Studio vsId={VS} />);
    fireEvent.click(within(await card('Shot 1.2')).getByRole('button', { name: 'Edit' }));
    const panel = screen.getByRole('form', { name: 'Edit shot 1.2' });
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(1));
    expect(panel.closest('aside')).toBe(scrolled.mock.contexts[0]);
    fireEvent.click(within(await card('Shot 1.2')).getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(scrolled).toHaveBeenCalledTimes(2));
  });

  it('on a wide screen the shot panel is already beside the grid, so Edit does not scroll', async () => {
    setPhone(false);
    routes();
    render(<Studio vsId={VS} />);
    fireEvent.click(within(await card('Shot 1.2')).getByRole('button', { name: 'Edit' }));
    screen.getByRole('form', { name: 'Edit shot 1.2' });
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('the spend bar is pinned only on wide screens, with one short line pinned on phones', async () => {
    routes(undefined, () => tree({ spentUsd: 1.5, reservedUsd: 0.15 }));
    render(<Studio vsId={VS} />);
    const bar = await screen.findByRole('contentinfo', { name: 'Spend and timeline' });
    expect(bar.className).toMatch(/(^| )lg:sticky( |$)/);
    expect(bar.className).not.toMatch(/(^| )sticky( |$)/);
    const line = screen.getByText('$1.65 of $40.00 · 58/60 s filled · 0/2 chosen');
    expect(line.className).toMatch(/(^| )sticky( |$)/);
    expect(line.className).toMatch(/lg:hidden/);
    expect(document.querySelectorAll('#vs-budget')).toHaveLength(1);
  });

  it('tapping a still picture chooses it', async () => {
    const t = tree();
    t.candidates = [still(CD)];
    routes((url) => (url.endsWith('/select') ? json({ success: true, data: {} }) : undefined), () => t);
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    fireEvent.click(await within(c).findByRole('img', { name: 'Candidate 1 for Shot 1.1' }));
    await waitFor(() => expect(calls('/select')).toHaveLength(1));
    expect(JSON.parse(calls('/select')[0][1].body)).toEqual({ sceneOrder: 1, shotOrder: 1, candId: CD });
  });

  it('the chosen picture reads "✓ Chosen"; the others offer "Tap to choose"', async () => {
    const t = tree();
    const other = 'cd_1730000000001_abcdef12';
    t.candidates = [still(CD), still(other)];
    t.shots[0].selectedCandidateId = CD;
    routes(undefined, () => t);
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.1');
    expect(within(c).getByText('✓ Chosen')).toBeInTheDocument();
    expect(within(c).getByText('Tap to choose')).toBeInTheDocument();
  });

  it('Rename saves the new title with a PATCH and reloads', async () => {
    routes((url, init) => (url === `/api/admin/visual-story/${VS}` && init?.method === 'PATCH' ? json({ success: true, data: {} }) : undefined));
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Story title');
    expect(input).toHaveValue('Test song');
    fireEvent.change(input, { target: { value: '  New name ' } });
    const loadsBefore = treeLoads().length;
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    await waitFor(() => expect(treeLoads().length).toBeGreaterThan(loadsBefore));
    const patch = mockFetch.mock.calls.find(([, i]) => i?.method === 'PATCH');
    expect(JSON.parse(patch![1].body)).toEqual({ title: 'New name' });
    expect(screen.queryByLabelText('Story title')).not.toBeInTheDocument();
  });

  it('rename and delete never show together, and the title stays a heading while renaming', async () => {
    routes();
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete story' }));
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Delete this story?' })).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Test song' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete story' })).not.toBeInTheDocument();
  });

  it('a refused rename shows its reason beside the title field', async () => {
    routes((url, init) => (init?.method === 'PATCH' ? json({ success: false, error: 'Title is required' }, 400) : undefined));
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    const form = screen.getByRole('form', { name: 'Rename story' });
    expect(await within(form).findByRole('alert')).toHaveTextContent('Title is required');
  });

  it('Delete story asks first, then deletes and goes back to the story list', async () => {
    routes((url, init) => (url === `/api/admin/visual-story/${VS}` && init?.method === 'DELETE' ? json({ success: true }) : undefined));
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete story' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete this story?' });
    expect(confirm).toHaveTextContent('Delete "Test song" with its 2 shots, pictures and clips? This cannot be undone. Money already spent is not refunded.');
    expect(mockFetch.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/visual-story'));
  });

  it('a refused delete (a draft or clip is running) shows its reason in the confirm and stays', async () => {
    routes((url, init) => (init?.method === 'DELETE' ? json({ success: false, error: 'Wait for the draft to finish first.' }, 409) : undefined));
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete story' }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete this story?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Wait for the draft to finish first.');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('with no shots yet, the draft panel comes before the shot grid; with shots, after it', async () => {
    const empty = tree();
    empty.shots = [];
    routes(undefined, () => empty);
    const { unmount } = render(<Studio vsId={VS} />);
    const draft = await screen.findByRole('region', { name: 'Storyboard draft' });
    const grid = screen.getByRole('region', { name: 'Shots in Scene 1' });
    expect(draft.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    routes();
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    const draft2 = screen.getByRole('region', { name: 'Storyboard draft' });
    const grid2 = screen.getByRole('region', { name: 'Shots in Scene 1' });
    expect(grid2.compareDocumentPosition(draft2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('with no scenes, the empty grid no longer points "below"', async () => {
    const empty = tree();
    empty.scenes = [];
    empty.shots = [];
    routes(undefined, () => empty);
    render(<Studio vsId={VS} />);
    expect(await screen.findByText(/No scenes yet/)).not.toHaveTextContent(/below/);
  });
});

describe('the story\'s Style', () => {
  it('shows none set, and saves a style with PATCH, then reloads', async () => {
    let saved = '';
    routes((url, init) => {
      if (url === `/api/admin/visual-story/${VS}` && init?.method === 'PATCH') {
        saved = JSON.parse(String(init.body)).style;
        return json({ success: true });
      }
      return undefined;
    }, () => ({ ...tree(), story: { ...tree().story, style: saved } }));
    render(<Studio vsId={VS} />);
    expect(await screen.findByText('none set')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set style' }));
    fireEvent.change(screen.getByLabelText('Style'), { target: { value: ' hand-painted watercolour ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
    expect(await screen.findByText('hand-painted watercolour')).toBeInTheDocument();
    expect(saved).toBe('hand-painted watercolour');
    expect(screen.getByRole('button', { name: 'Edit style' })).toBeInTheDocument();
  });

  it('shows the server\'s refusal beside the field', async () => {
    routes((url, init) =>
      url === `/api/admin/visual-story/${VS}` && init?.method === 'PATCH'
        ? json({ success: false, error: 'Keep the style under 300 characters' }, 400)
        : undefined);
    render(<Studio vsId={VS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set style' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }));
    const alert = await screen.findByText('Keep the style under 300 characters');
    expect(screen.getByRole('form', { name: 'Story style' })).toContainElement(alert);
  });
});

describe('steps bar and song timeline', () => {
  it('shows the four steps with the next one marked', async () => {
    routes();
    render(<Studio vsId={VS} />);
    const steps = await screen.findByRole('list', { name: 'Steps' });
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    // 58 of 60 s filled: storyboard done, filling the song is next.
    expect(items[0]).toHaveTextContent('1. Storyboard');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[1]).toHaveTextContent('0:58 of 1:00');
  });

  it('lays every shot on the timeline and opens one when pressed', async () => {
    routes();
    render(<Studio vsId={VS} />);
    const strip = await screen.findByRole('region', { name: 'Song timeline' });
    const second = within(strip).getByRole('button', { name: 'Scene 1, shot 2, 28 s, nothing chosen' });
    expect(within(strip).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(second);
    expect(second).toHaveAttribute('aria-current', 'true');
    // The shot panel opens on that shot.
    expect(screen.getByRole('form', { name: 'Edit shot 1.2' })).toBeInTheDocument();
  });

  it('opens a shot in another scene, switching the grid to that scene', async () => {
    const t = tree();
    t.scenes.push({ order: 2, heading: 'Scene 2', summary: 'Later' });
    t.shots = [shot(1, 1, 30, 0), shot(2, 1, 30, 30)];
    routes(undefined, () => t);
    render(<Studio vsId={VS} />);
    await card('Shot 1.1');
    expect(screen.queryByRole('article', { name: /Shot 2\.1/ })).toBeNull();
    fireEvent.click(within(screen.getByRole('region', { name: 'Song timeline' })).getByRole('button', { name: /Scene 2, shot 1/ }));
    expect(await card('Shot 2.1')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Edit shot 2.1' })).toBeInTheDocument();
  });
});
