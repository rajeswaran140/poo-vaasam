/** @jest-environment jsdom */
/**
 * UNIT/COMPONENT TESTS — BriefReusePanel. Loads a composed brief back into the
 * composer from a .json file (validated) or from the saved-brief library.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BriefReusePanel } from '@/components/admin/BriefReusePanel';
import { adminFetch } from '@/lib/client-auth';
import { serializeBriefFile } from '@/lib/prompt-export';
import type { ComposerAnalysis } from '@/services/ai/composerSchema';

jest.mock('@/lib/client-auth', () => ({ adminFetch: jest.fn() }));
jest.mock('lucide-react', () => ({
  Upload: () => <svg data-testid="icon-upload" />,
  FolderOpen: () => <svg data-testid="icon-folder" />,
}));
const mockFetch = adminFetch as jest.Mock;

const ANALYSIS: ComposerAnalysis = {
  emotion: 'காதல்',
  emotion_breakdown: ['காதல்', 'ஏக்கம்'],
  mood: 'Tender',
  theme: 'Homeland love',
  suggested_key: 'D Minor',
  suggested_bpm: 72,
  suggested_instruments: ['Flute'],
  suggested_ragas: ['Kaapi'],
  recommended_voice: ['Female Adult'],
  song_titles: ['மண்வாசம்'],
  suno_prompts: [{ style: 'Devotional', prompt: 'Soft devotional Tamil ballad.' }],
  thumbnail_prompt: 'A misty paddy field at dawn.',
  youtube_description_tamil: 'தமிழ் #tamilagaval',
  youtube_description_english: 'English #tamilagaval',
  reel: { hook: 'மண்வாசம்', caption: 'Homeland', hashtags: ['#tamil'] },
};

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

beforeEach(() => mockFetch.mockReset());

it('loads a valid brief file and calls onLoad with its lyrics + analysis', async () => {
  const onLoad = jest.fn();
  render(<BriefReusePanel onLoad={onLoad} />);
  const file = { text: async () => serializeBriefFile('paddy field lyrics', ANALYSIS) } as unknown as File;
  fireEvent.change(fileInput(), { target: { files: [file] } });
  await waitFor(() => expect(onLoad).toHaveBeenCalled());
  expect(onLoad).toHaveBeenCalledWith('paddy field lyrics', expect.objectContaining({ song_titles: ['மண்வாசம்'] }));
});

it('shows an error for an invalid file and does not call onLoad', async () => {
  const onLoad = jest.fn();
  render(<BriefReusePanel onLoad={onLoad} />);
  const file = { text: async () => 'not a brief' } as unknown as File;
  fireEvent.change(fileInput(), { target: { files: [file] } });
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(onLoad).not.toHaveBeenCalled();
});

it('lists saved briefs on "My briefs" and loads one on click', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: [{ id: 'b1', createdAt: '2026-07-01T00:00:00Z', lyrics: 'L1', analysis: ANALYSIS }],
    }),
  });
  const onLoad = jest.fn();
  render(<BriefReusePanel onLoad={onLoad} />);
  fireEvent.click(screen.getByRole('button', { name: /My briefs/i }));
  const item = await screen.findByRole('button', { name: /மண்வாசம்/ });
  fireEvent.click(item);
  await waitFor(() =>
    expect(onLoad).toHaveBeenCalledWith('L1', expect.objectContaining({ song_titles: ['மண்வாசம்'] }))
  );
  expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/briefs?limit=50'));
});

it('surfaces an error when the briefs list fails to load', async () => {
  mockFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ success: false, error: 'boom' }) });
  render(<BriefReusePanel onLoad={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /My briefs/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/boom/);
});
