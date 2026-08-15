/**
 * Composition Notebook UI.
 *
 * Focused on the three behaviours that are requirements rather than styling:
 * saving is not versioning, a blank provenance is not authorship, and the Suno
 * export never carries the lyrics.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CompositionNotebook } from '@/components/admin/music/CompositionNotebook';

const COMPOSITION = {
  id: 'cmp_1',
  title: 'மழை',
  status: 'sketch',
  spec: { bpm: 90, meter: '6/8', lyrics: 'மழை பெய்தால் மண் வாசம்', aiMusicPrompt: 'warm acoustic ballad' },
  versions: [
    { version: 1, label: 'V1', spec: { bpm: 80, meter: '4/4' }, createdAt: '2026-08-01T00:00:00.000Z' },
    { version: 2, label: 'V2', spec: { bpm: 90, meter: '6/8' }, createdAt: '2026-08-02T00:00:00.000Z' },
  ],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

const calls: { url: string; method?: string; body?: string }[] = [];

beforeEach(() => {
  calls.length = 0;
  Object.assign(navigator, { clipboard: { writeText: jest.fn() } });
  global.fetch = jest.fn(async (url: RequestInfo | URL, opts?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: opts?.method, body: opts?.body as string });
    if (u.endsWith('/compositions')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: [{ id: 'cmp_1', title: 'மழை', status: 'sketch', versionCount: 2, updatedAt: '2026-08-02T00:00:00.000Z' }] }) } as Response;
    }
    if (u.includes('/versions')) {
      return { ok: true, status: 201, json: async () => ({ success: true, data: COMPOSITION }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: COMPOSITION }) } as Response;
  });
});
afterEach(() => jest.restoreAllMocks());

const openComposition = async () => {
  render(<CompositionNotebook />);
  fireEvent.click(await screen.findByRole('button', { name: /மழை/ }));
  await screen.findByLabelText('title');
};

describe('saving is not versioning', () => {
  it('Save writes the working state and creates no version', async () => {
    await openComposition();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.some((c) => c.url.includes('/versions'))).toBe(false);
  });

  it('Save version posts to the versions endpoint', async () => {
    jest.spyOn(window, 'prompt').mockReturnValueOnce('V3').mockReturnValueOnce('slower');
    await openComposition();
    fireEvent.click(screen.getByRole('button', { name: /save version/i }));

    await waitFor(() => {
      const v = calls.find((c) => c.url.includes('/versions'));
      expect(v?.method).toBe('POST');
      expect(JSON.parse(v!.body!)).toMatchObject({ label: 'V3', note: 'slower' });
    });
  });

  it('lists earlier versions without overwriting them', async () => {
    await openComposition();
    // V1/V2 appear both in the list and in the compare dropdowns, so assert on
    // the list entries specifically rather than on the label text alone.
    const listed = screen.getAllByText('V1').filter((el) => el.tagName !== 'OPTION');
    expect(listed).toHaveLength(1);
    expect(screen.getAllByText('V2').filter((el) => el.tagName !== 'OPTION')).toHaveLength(1);
  });

  it('compares two versions and reports what changed', async () => {
    await openComposition();
    fireEvent.change(screen.getByLabelText('compare from'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('compare to'), { target: { value: '2' } });
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
  });
});

/** ⚠️ §24 — a blank source means "not recorded", never "user-entered". */
describe('provenance', () => {
  it('offers a source selector for each analytical field, defaulting to not recorded', async () => {
    await openComposition();
    // One selector per analytical field (bpm, meter, tonic, scale, raga), each
    // starting blank — "not recorded", which is not the same as user-entered.
    for (const field of ['bpm', 'meter', 'tonic', 'scale', 'raga']) {
      const select = screen.getByLabelText(`source of ${field}`) as HTMLSelectElement;
      expect(select.value).toBe('');
    }
    expect(screen.getAllByText(/not recorded/i).length).toBeGreaterThan(0);
  });

  it('sends the chosen source with the save', async () => {
    await openComposition();
    fireEvent.change(screen.getByLabelText('source of meter'), { target: { value: 'suggested' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const put = calls.find((c) => c.method === 'PUT');
      expect(JSON.parse(put!.body!).spec.sources).toEqual({ meter: 'suggested' });
    });
  });

  it('spells out that blank is not authorship', async () => {
    await openComposition();
    expect(screen.getByText(/not.*user-entered/i)).toBeInTheDocument();
  });
});

/** ⚠️ §17 + AI music rights. */
describe('AI prompt export', () => {
  it('copies the musical decisions but never the lyrics', async () => {
    await openComposition();
    fireEvent.click(screen.getByRole('button', { name: /copy for suno/i }));

    const copied = (navigator.clipboard.writeText as jest.Mock).mock.calls[0][0] as string;
    expect(copied).toContain('warm acoustic ballad');
    expect(copied).toContain('90 BPM');
    expect(copied).not.toContain('மழை பெய்தால்');
  });

  it('says so in the UI', async () => {
    await openComposition();
    expect(screen.getByText(/never includes your lyrics/i)).toBeInTheDocument();
  });
});
