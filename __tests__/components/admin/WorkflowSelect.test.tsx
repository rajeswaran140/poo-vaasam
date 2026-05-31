/** @jest-environment jsdom */

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkflowSelect } from '@/components/admin/WorkflowSelect';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;
const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as unknown as Response);
const fail = (s: number, b: unknown) => ({ ok: false, status: s, json: async () => b } as unknown as Response);

beforeEach(() => mockedFetch.mockReset());

it('renders the unset sentinel plus every workflow state', () => {
  render(<WorkflowSelect contentId="cnt_a" initialState="draft" hasExplicit={false} />);
  const select = screen.getByLabelText('Workflow state') as HTMLSelectElement;
  const values = Array.from(select.options).map((o) => o.value);
  expect(values).toEqual([
    '__unset__',
    'draft',
    'lyrics_complete',
    'ai_reviewed',
    'music_generated',
    'midi_reviewed',
    'stems_uploaded',
    'video_created',
    'published_youtube',
    'published_site',
  ]);
});

it('PATCHes the new state and announces "Saved"', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true }));
  render(<WorkflowSelect contentId="cnt_a" initialState="draft" hasExplicit={false} />);

  fireEvent.change(screen.getByLabelText('Workflow state'), { target: { value: 'midi_reviewed' } });

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
  const [url, init] = mockedFetch.mock.calls[0];
  expect(url).toBe('/api/admin/content/cnt_a/workflow');
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ state: 'midi_reviewed' });

  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
});

it('sends empty string when "—" is picked (clears explicit state)', async () => {
  mockedFetch.mockResolvedValueOnce(ok({ success: true }));
  render(<WorkflowSelect contentId="cnt_a" initialState="midi_reviewed" hasExplicit={true} />);

  fireEvent.change(screen.getByLabelText('Workflow state'), { target: { value: '__unset__' } });

  await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mockedFetch.mock.calls[0][1].body)).toEqual({ state: '' });
  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Reset/));
});

it('reverts to the previous state on PATCH failure', async () => {
  mockedFetch.mockResolvedValueOnce(fail(500, { success: false, error: 'DB write failed' }));
  render(<WorkflowSelect contentId="cnt_a" initialState="draft" hasExplicit={true} />);

  const select = screen.getByLabelText('Workflow state') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'midi_reviewed' } });

  await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Save failed/));
  expect(select.value).toBe('draft');
});
