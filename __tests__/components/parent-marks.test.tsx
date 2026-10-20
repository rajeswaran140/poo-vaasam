/** @jest-environment jsdom */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ParentMarksPanel } from '@/components/admin/ParentMarksPanel';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const pm = (over: Record<string, unknown>) => ({
  markId: 'x', masterJobId: 'p1', start: 0, end: null, reason: 'pronunciation', note: '', status: 'open',
  fixedIn: null, version: 1, createdAt: 't', updatedAt: 't', ...over,
});
const json = (status: number, body: unknown) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);

beforeEach(() => mockedFetch.mockReset());

function setup(onStillThere = jest.fn()) {
  mockedFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/master/p1/marks') && !init?.method) {
      return json(200, { success: true, marks: [
        pm({ markId: 'done', start: 10, status: 'fixed', note: 'old fix' }),
        pm({ markId: 'open1', start: 102, note: 'ழ sung as ல' }),
      ] });
    }
    if (init?.method === 'PATCH') return json(200, { success: true, mark: pm({ markId: 'open1', start: 102, status: 'fixed', fixedIn: 'c1', version: 2 }) });
    return json(200, { success: true });
  });
  render(<ParentMarksPanel parent={{ jobId: 'p1', via: 're-master', title: 'பாடல்' }} masterJobId="c1" onStillThere={onStillThere} />);
  return onStillThere;
}

it('lists the parent\'s marks at the PARENT\'s times, open first, under a lineage heading', async () => {
  setup();
  expect(await screen.findByText(/Re-master of பாடல்/)).toBeTruthy();
  const items = await screen.findAllByRole('listitem');
  expect(items[0].textContent).toContain('1:42');
  expect(items[1].textContent).toContain('0:10');
});

it('Fixed here marks the parent mark fixed, crediting this version', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: /Fixed here.*1:42/ }));
  await waitFor(() => {
    const patch = mockedFetch.mock.calls.find(([, i]) => i?.method === 'PATCH');
    expect(patch![0]).toContain('/master/p1/marks/open1');
    expect(JSON.parse(patch![1].body)).toEqual({ version: 1, status: 'fixed', fixedIn: 'c1' });
  });
});

it('Still there hands the mark to this version unchanged, for Raj to re-time', async () => {
  const onStillThere = setup();
  fireEvent.click(await screen.findByRole('button', { name: /Still there.*1:42/ }));
  expect(onStillThere).toHaveBeenCalledWith({ start: 102, end: null, reason: 'pronunciation', note: 'ழ sung as ல' });
});

it('offers no buttons on marks that are already closed', async () => {
  setup();
  await screen.findAllByRole('listitem');
  expect(screen.queryByRole('button', { name: /Fixed here.*0:10/ })).toBeNull();
});
