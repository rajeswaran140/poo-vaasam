/** @jest-environment jsdom */
/**
 * The draft panel (audit 2026-11-09). A whole-song draft runs up to ~7
 * minutes; a reload used to drop it and the next press paid for a second one.
 * Pinned: a draft already running is followed on load, and a press that the
 * server refuses because one is running follows that one instead of failing.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
import { render, screen, fireEvent, act } from '@testing-library/react';
import { adminFetch } from '@/lib/client-auth';
import { DraftPanel } from '@/components/admin/visual-story/DraftPanel';

const mockFetch = adminFetch as jest.Mock;
const VS = 'vs_1700000000000_abcdef12';
const JOB = 'dj_1700000000000_abcdef12';
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
const flush = () => act(async () => { await jest.advanceTimersByTimeAsync(10_000); });

function setup(liveJobId: string | null = null) {
  const onChanged = jest.fn();
  render(
    <DraftPanel vsId={VS} windowSec={240} sceneCount={0} shotCount={0} lastDraft={null} liveJobId={liveJobId} onChanged={onChanged} onApplied={jest.fn()} />
  );
  return { onChanged };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
});
afterEach(() => jest.useRealTimers());

it('a draft already running when the page loads is followed: the button waits, and the draft arrives', async () => {
  mockFetch.mockImplementation(async (url: string) =>
    url.endsWith(`/draft/jobs/${JOB}`) ? json({ status: 'done', result: { draftId: 'dr_1' } }) : json({}));
  const { onChanged } = setup(JOB);
  expect(screen.getByText(/A draft is being made/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Draft storyboard|Drafting/ })).toBeDisabled();
  await flush();
  expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith(`/draft/jobs/${JOB}`))).toBe(true);
  expect(mockFetch.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  expect(onChanged).toHaveBeenCalled();
});

it('a press refused because a draft is running follows that draft instead of showing an error', async () => {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/draft') && init?.method === 'POST') {
      return json({ success: false, error: 'A draft is already being made. It shows here when it is ready.', data: { jobId: JOB } }, 409);
    }
    if (url.endsWith(`/draft/jobs/${JOB}`)) return json({ status: 'done', result: { draftId: 'dr_1' } });
    return json({});
  });
  const { onChanged } = setup();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'line one\nline two' } });
  fireEvent.click(screen.getByRole('button', { name: /Draft storyboard/ }));
  await flush();
  expect(mockFetch.mock.calls.some(([u]) => String(u).endsWith(`/draft/jobs/${JOB}`))).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(onChanged).toHaveBeenCalled();
});

it('says a whole-song draft can take several minutes', () => {
  mockFetch.mockResolvedValue(json({}));
  setup();
  expect(screen.getByText(/up to about 7 minutes for a whole song/)).toBeInTheDocument();
});
