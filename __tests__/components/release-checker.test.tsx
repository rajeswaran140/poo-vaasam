/** @jest-environment jsdom */
/**
 * ReleaseChecker — the paste-anything URL parsing and the rendering of a
 * result. The grading itself is tested in lib/release-checklist.
 */
jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReleaseChecker, extractVideoId } from '@/components/admin/ReleaseChecker';
import { adminFetch } from '@/lib/client-auth';

const mockedFetch = adminFetch as jest.Mock;

describe('extractVideoId — accepts whatever the browser was showing', () => {
  it('takes a bare id', () => {
    expect(extractVideoId('v8_WUOE7i2M')).toBe('v8_WUOE7i2M');
  });

  it('takes a /shorts/ URL — the form Raj actually pastes', () => {
    expect(extractVideoId('https://youtube.com/shorts/v8_WUOE7i2M')).toBe('v8_WUOE7i2M');
  });

  it('takes a watch URL, with or without extra params', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=7ad3auZmrbc')).toBe('7ad3auZmrbc');
    expect(extractVideoId('https://www.youtube.com/watch?v=7ad3auZmrbc&t=42s')).toBe('7ad3auZmrbc');
  });

  it('takes a youtu.be short link', () => {
    expect(extractVideoId('https://youtu.be/PTS7KJHGPRo')).toBe('PTS7KJHGPRo');
  });

  it('tolerates surrounding whitespace', () => {
    expect(extractVideoId('  v8_WUOE7i2M \n')).toBe('v8_WUOE7i2M');
  });

  it('rejects nonsense rather than sending a bad request', () => {
    expect(extractVideoId('hello')).toBeNull();
    expect(extractVideoId('')).toBeNull();
  });
});

const ready = {
  videoId: 'v8_WUOE7i2M',
  title: 'ஈழத்து மண்ணே | Eelathu Manne',
  isShort: true,
  durationSeconds: 112,
  captionsChecked: true,
  blockers: 0,
  gaps: 0,
  notes: 1,
  ready: true,
  findings: [
    { id: 'pinned-comment', severity: 'note', title: 'Pinned comment cannot be verified', detail: 'Studio.', manual: true },
  ],
  quota: { used: 65, limit: 10000, spent: 65 },
};

beforeEach(() => mockedFetch.mockReset());

describe('rendering a result', () => {
  it('shows Ready when nothing is outstanding', async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ready } as Response);
    render(<ReleaseChecker />);
    fireEvent.change(screen.getByLabelText(/video id or URL/i), {
      target: { value: 'https://youtube.com/shorts/v8_WUOE7i2M' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/Ready/)).toBeInTheDocument();
  });

  it('keeps notes out of the main list so they do not read as work', async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ready } as Response);
    render(<ReleaseChecker />);
    fireEvent.change(screen.getByLabelText(/video id or URL/i), { target: { value: 'v8_WUOE7i2M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/1 note — nothing to fix/)).toBeInTheDocument();
  });

  it('surfaces blockers with their count', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...ready,
        ready: false,
        blockers: 1,
        gaps: 0,
        findings: [
          { id: 'audio-language', severity: 'blocker', title: 'defaultAudioLanguage is not "ta"', detail: 'x', fix: 'ta' },
        ],
      }),
    } as Response);
    render(<ReleaseChecker />);
    fireEvent.change(screen.getByLabelText(/video id or URL/i), { target: { value: 'v8_WUOE7i2M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/1 blocker, 0 gaps/)).toBeInTheDocument();
    expect(screen.getByText('Blocker')).toBeInTheDocument();
  });

  it('warns when captions could not be read, so absent is not read as clear', async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...ready, captionsChecked: false }),
    } as Response);
    render(<ReleaseChecker />);
    fireEvent.change(screen.getByLabelText(/video id or URL/i), { target: { value: 'v8_WUOE7i2M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/absent, not clear/i)).toBeInTheDocument();
  });

  it('rejects a bad input without calling the API at all', async () => {
    render(<ReleaseChecker />);
    fireEvent.change(screen.getByLabelText(/video id or URL/i), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(await screen.findByText(/does not look like/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows the API error message rather than a generic failure', async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { code: 'QUOTA_GUARD', message: 'quota guard tripped' } }),
    } as Response);
    render(<ReleaseChecker />);
    fireEvent.change(screen.getByLabelText(/video id or URL/i), { target: { value: 'v8_WUOE7i2M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(screen.getByText(/quota guard tripped/)).toBeInTheDocument());
  });
});
