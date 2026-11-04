/** @jest-environment jsdom */
/**
 * COMPONENT TESTS — Visual Story Studio list page pieces: the story table,
 * the "New from master" form and its window picker.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StoryList } from '@/components/admin/visual-story/StoryList';
import { NewStoryForm } from '@/components/admin/visual-story/NewStoryForm';
import { WindowPicker } from '@/components/admin/visual-story/WindowPicker';
import { adminFetch } from '@/lib/client-auth';
import type { VisualStory } from '@/types/visualStory';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
const mockFetch = adminFetch as jest.Mock;

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const STORY: VisualStory = {
  vsId: 'vs-1', masterJobId: 'job-1', audioKey: 'audio/x.wav', contentId: null,
  title: 'Test song', status: 'DRAFT', aspectRatio: '16:9', providerId: 'grok',
  windowStartSec: 0, windowEndSec: 60, budgetUsdCap: 40, spentUsd: 0.42,
  reservedUsd: 0, committedUsd: 0.42, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};

const master = (over: Record<string, unknown>) => ({
  jobId: 'job-1', title: 'Test song', editedDurationSec: 95, masterKey: 'k', savedAt: '2026-11-01', ...over,
});

function mockMasters(masters: unknown[]) {
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).startsWith('/api/admin/music-lab/masters')) return json({ success: true, masters, nextCursor: null });
    return json({ success: true });
  });
}

beforeEach(() => mockFetch.mockReset());

describe('StoryList', () => {
  it('renders spend as "$0.42 of $40.00" and links to the studio', () => {
    render(<StoryList stories={[STORY]} />);
    expect(screen.getByText('$0.42 of $40.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Test song/ })).toHaveAttribute('href', '/admin/visual-story/vs-1');
    expect(screen.getByText('16:9')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  it('renders the shot count, and a dash when the count is unknown', () => {
    render(<StoryList stories={[{ ...STORY, shotCount: 12 }, { ...STORY, vsId: 'vs-2', title: 'Other test', shotCount: null }]} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows an empty message with no stories', () => {
    render(<StoryList stories={[]} />);
    expect(screen.getByText(/no stories yet/i)).toBeInTheDocument();
  });
});

describe('WindowPicker', () => {
  it('clamps a 120 s length to song length minus start, shows the end, emits integers', () => {
    const onChange = jest.fn();
    render(<WindowPicker songSec={95} startSec={10} lengthSec={60} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/length/i), { target: { value: '120' } });
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 10, lengthSec: 85, valid: true });
  });

  it('parses m:ss start and floors fractions', () => {
    const onChange = jest.fn();
    render(<WindowPicker songSec={300} startSec={0} lengthSec={60} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: '1:05.7' } });
    const last = onChange.mock.calls.at(-1)[0];
    expect(last).toEqual({ startSec: 65, lengthSec: 60, valid: true });
    expect(Number.isInteger(last.startSec) && Number.isInteger(last.lengthSec)).toBe(true);
  });

  it.each(['abc', '1:75', '9:00'])('flags start "%s" as invalid and reports it', (text) => {
    const onChange = jest.fn();
    render(<WindowPicker songSec={95} startSec={0} lengthSec={60} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: text } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('an emptied length field stays empty and is invalid until blur restores the minimum', () => {
    const onChange = jest.fn();
    render(<WindowPicker songSec={300} startSec={0} lengthSec={60} onChange={onChange} />);
    const input = screen.getByLabelText(/length/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ valid: false }));
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ lengthSec: 0 }));
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith({ startSec: 0, lengthSec: 30, valid: true });
  });

  it('displays the end as m:ss', () => {
    render(<WindowPicker songSec={95} startSec={0} lengthSec={95} onChange={() => {}} />);
    expect(screen.getByText(/ends 1:35/i)).toBeInTheDocument();
  });
});

describe('NewStoryForm', () => {
  it('clamps the window when a master with editedDurationSec 95 is picked', async () => {
    mockMasters([master({})]);
    render(<NewStoryForm onCreated={() => {}} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Test song/ }));
    fireEvent.change(screen.getByLabelText(/length/i), { target: { value: '120' } });
    expect(screen.getByLabelText(/length/i)).toHaveValue(95);
    expect(screen.getByText(/ends 1:35/i)).toBeInTheDocument();
  });

  it('lists masters without a length but disables them with "no recorded length"', async () => {
    mockMasters([master({ jobId: 'job-2', title: 'Other test', editedDurationSec: null })]);
    render(<NewStoryForm onCreated={() => {}} />);
    const radio = await screen.findByRole('radio', { name: /Other test/ });
    expect(radio).toBeDisabled();
    expect(screen.getByText(/no recorded length/i)).toBeInTheDocument();
  });

  it('shows a 400 from create beneath the submit button', async () => {
    mockMasters([master({})]);
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ success: false, error: 'The window ends after the song does (song is 1:35).' }, 400);
      return json({ success: true, masters: [master({})], nextCursor: null });
    });
    render(<NewStoryForm onCreated={() => {}} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Test song/ }));
    const submit = screen.getByRole('button', { name: /create story/i });
    fireEvent.click(submit);
    const err = await screen.findByText(/window ends after the song/i);
    expect(err).toHaveAttribute('role', 'alert');
    expect(submit.parentElement).toContainElement(err);
  });

  it('disables Create while the start text is invalid', async () => {
    mockMasters([master({ editedDurationSec: 300 })]);
    render(<NewStoryForm onCreated={() => {}} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Test song/ }));
    const submit = screen.getByRole('button', { name: /create story/i });
    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: 'abc' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: '0:10' } });
    expect(submit).toBeEnabled();
  });

  it('posts integer seconds, aspect and budget, then calls onCreated', async () => {
    const onCreated = jest.fn();
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ success: true, data: { ...STORY, vsId: 'vs-9' } }, 201);
      return json({ success: true, masters: [master({})], nextCursor: null });
    });
    render(<NewStoryForm onCreated={onCreated} />);
    fireEvent.click(await screen.findByRole('radio', { name: /Test song/ }));
    fireEvent.click(screen.getByRole('radio', { name: '9:16' }));
    fireEvent.click(screen.getByRole('button', { name: /create story/i }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('vs-9'));
    const call = mockFetch.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(call[0]).toBe('/api/admin/visual-story');
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({
      masterJobId: 'job-1', title: 'Test song', aspectRatio: '9:16',
      windowStartSec: 0, windowEndSec: 60, budgetUsdCap: 40,
    });
  });
});
