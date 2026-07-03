/** @jest-environment node */
/**
 * Unit tests for src/lib/songs-visibility.ts — hides non-YouTube songs from
 * public listings while on-site playback is off (funnel-to-YouTube).
 */
import { listableSongs } from '@/lib/songs-visibility';
import { isAudioPlaybackEnabled } from '@/config/features';

jest.mock('@/config/features', () => ({
  ...jest.requireActual('@/config/features'),
  isAudioPlaybackEnabled: jest.fn(),
}));
const mockPlayback = isAudioPlaybackEnabled as jest.Mock;

const songs = [
  { id: 'a', youtubeVideoId: 'aaaaaaaaaaa' },
  { id: 'b', youtubeVideoId: undefined },
  { id: 'c', youtubeVideoId: '' },
  { id: 'd', youtubeVideoId: 'ddddddddddd' },
];

it('hides songs without a YouTube video when playback is OFF', () => {
  mockPlayback.mockReturnValue(false);
  expect(listableSongs(songs).map((s) => s.id)).toEqual(['a', 'd']);
});

it('shows every song when playback is ON', () => {
  mockPlayback.mockReturnValue(true);
  expect(listableSongs(songs).map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
});

it('is a no-op on an empty list', () => {
  mockPlayback.mockReturnValue(false);
  expect(listableSongs([])).toEqual([]);
});
