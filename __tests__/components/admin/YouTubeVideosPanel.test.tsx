/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { YouTubeVideosPanel } from '@/components/admin/YouTubeVideosPanel';
import { adminFetch } from '@/lib/client-auth';
import type { VideoRow } from '@/lib/youtube-dashboard';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const adminFetchMock = adminFetch as jest.Mock;
beforeEach(() => adminFetchMock.mockReset());

const mkRow = (over: Partial<VideoRow> & { id: string }): VideoRow => ({
  id: over.id,
  title: over.title ?? `Video ${over.id}`,
  publishedAt: over.publishedAt ?? '2026-06-01T00:00:00Z',
  viewCount: over.viewCount ?? 0,
  likeCount: over.likeCount ?? 0,
  commentCount: over.commentCount ?? 0,
  durationSeconds: over.durationSeconds ?? 240,
  realViews: over.realViews ?? null,
  subscribersGained: over.subscribersGained ?? null,
  estimatedMinutesWatched: over.estimatedMinutesWatched ?? null,
  averageViewDuration: over.averageViewDuration ?? null,
  retentionPct: over.retentionPct ?? null,
});

// 23 rows: titles "Song 00".."Song 22", ascending viewCounts, descending dates.
const manyRows = Array.from({ length: 23 }, (_, i) =>
  mkRow({
    id: `v${i}`,
    title: `Song ${String(i).padStart(2, '0')}`,
    viewCount: i * 10,
    publishedAt: `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  })
);

const titles = () =>
  screen.getAllByRole('link').map((a) => a.textContent); // each row title is a YT link

describe('YouTubeVideosPanel', () => {
  it('paginates: shows 10 rows and advances pages', () => {
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured={false} />);
    expect(screen.getByText('1–10 of 23')).toBeInTheDocument();
    expect(screen.getByText('Page 1 / 3')).toBeInTheDocument();
    expect(titles()).toHaveLength(10);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('11–20 of 23')).toBeInTheDocument();
    expect(screen.getByText('Page 2 / 3')).toBeInTheDocument();

    // First/Previous disabled on page 1
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('changes page size', () => {
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured={false} />);
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
    expect(screen.getByText('1–23 of 23')).toBeInTheDocument();
    expect(titles()).toHaveLength(23);
  });

  it('sorts by a numeric column when its header is clicked', () => {
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured={false} />);
    // default sort is publishedAt desc -> newest (Song 22) first
    expect(titles()[0]).toBe('Song 22');
    // click Views (public) -> defaults to desc -> highest views (Song 22 too, since views grow with i)
    fireEvent.click(screen.getByRole('button', { name: /Views \(public\)/ }));
    expect(titles()[0]).toBe('Song 22');
    // toggle to asc -> lowest views (Song 00) first
    fireEvent.click(screen.getByRole('button', { name: /Views \(public\)/ }));
    expect(titles()[0]).toBe('Song 00');
  });

  it('filters by search query', () => {
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured={false} />);
    fireEvent.change(screen.getByPlaceholderText('Search title…'), { target: { value: 'Song 2' } });
    // "Song 2" matches Song 20, 21, 22 -> 3 matches
    expect(screen.getByText('1–3 of 3')).toBeInTheDocument();
  });

  it('hides owner-analytics columns when Analytics is not configured', () => {
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured={false} />);
    expect(screen.queryByRole('button', { name: /Real views/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retention/ })).not.toBeInTheDocument();
  });

  it('shows owner-analytics columns + date range when configured', () => {
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured initialDays={28} />);
    expect(screen.getByRole('button', { name: /Real views/ })).toBeInTheDocument();
    expect(screen.getByText('Last 28 days')).toBeInTheDocument();
  });

  it('shows an empty state when filters match nothing', () => {
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured={false} />);
    fireEvent.change(screen.getByPlaceholderText('Search title…'), { target: { value: 'zzz-nomatch' } });
    expect(screen.getByText('No videos match the current filters.')).toBeInTheDocument();
  });

  it('exports CSV via a blob download', () => {
    const createSpy = jest.fn(() => 'blob:url');
    const revokeSpy = jest.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createSpy;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeSpy;
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });

  it('re-queries analytics when the date range changes', async () => {
    adminFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        days: 90,
        // v22 is the newest -> on page 1 under the default publishedAt-desc sort
        videos: { ok: true, data: [{ videoId: 'v22', views: 9999, estimatedMinutesWatched: 10, averageViewDuration: 120, subscribersGained: 7 }] },
      }),
    });

    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured initialDays={28} />);
    fireEvent.change(screen.getByDisplayValue('Last 28 days'), { target: { value: '90' } });

    await waitFor(() => expect(adminFetchMock).toHaveBeenCalledWith(
      '/api/admin/youtube/analytics?days=90&recs=0'
    ));
    // v22's real views should now appear once state updates
    await waitFor(() => {
      const row = screen.getByText('Song 22').closest('tr')!;
      expect(within(row).getByText('9,999')).toBeInTheDocument();
    });
  });

  it('surfaces an error if the analytics re-query fails', async () => {
    adminFetchMock.mockResolvedValue({ ok: false, status: 503 });
    render(<YouTubeVideosPanel initialRows={manyRows} ytaConfigured initialDays={28} />);
    fireEvent.change(screen.getByDisplayValue('Last 28 days'), { target: { value: '90' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't update the date range/);
  });
});
