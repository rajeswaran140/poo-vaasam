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
jest.mock('@/lib/mastering-upload-client', () => ({ putToS3: jest.fn() }));
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
});

async function card(label: string) {
  return screen.findByRole('article', { name: label });
}

describe('Studio — shot cards', () => {
  it('shows the mode badge, prompt, character chip and m:ss span', async () => {
    routes();
    render(<Studio vsId={VS} />);
    const c = await card('Shot 1.2');
    expect(within(c).getByText('STILL')).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText(/lyrics/i), { target: { value: 'Line one\nLine two' } });
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
