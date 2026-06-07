/**
 * AudioTrack value object — immutable, validated, value-equal. Captures a
 * playable audio source (url + optional duration) and derives its MIME type
 * so clients (web player, Expo app) don't have to sniff the extension.
 */

import { AudioTrack } from '@/domain/songs/AudioTrack';

describe('AudioTrack', () => {
  it('trims the url', () => {
    expect(AudioTrack.fromUrl('  https://cdn.example.com/a.mp3  ').url).toBe(
      'https://cdn.example.com/a.mp3'
    );
  });

  it('rejects an empty / whitespace url', () => {
    expect(() => AudioTrack.fromUrl('')).toThrow();
    expect(() => AudioTrack.fromUrl('   ')).toThrow();
    // @ts-expect-error — exercising the runtime guard against a null url
    expect(() => AudioTrack.fromUrl(null)).toThrow();
  });

  it.each([
    ['https://x/song.mp3', 'audio/mpeg'],
    ['https://x/song.MP3', 'audio/mpeg'],
    ['https://x/song.wav', 'audio/wav'],
    ['https://x/song.m4a', 'audio/mp4'],
    ['https://x/song.aac', 'audio/mp4'],
    ['https://x/song.ogg', 'audio/ogg'],
    ['https://x/song.opus', 'audio/ogg'],
    ['https://x/song.flac', 'audio/flac'],
    ['https://x/song.weird', 'audio/mpeg'], // unknown → safe default
  ])('infers the MIME type for %s', (url, mime) => {
    expect(AudioTrack.fromUrl(url).mimeType).toBe(mime);
  });

  it('ignores a query string when inferring the MIME type (signed S3 URLs)', () => {
    expect(
      AudioTrack.fromUrl('https://s3/song.wav?X-Amz-Signature=deadbeef&x=1').mimeType
    ).toBe('audio/wav');
  });

  it('normalises duration: drops zero / negative / NaN, rounds floats', () => {
    expect(AudioTrack.fromUrl('https://x/a.mp3', 0).durationSeconds).toBeUndefined();
    expect(AudioTrack.fromUrl('https://x/a.mp3', -4).durationSeconds).toBeUndefined();
    expect(AudioTrack.fromUrl('https://x/a.mp3', NaN).durationSeconds).toBeUndefined();
    expect(AudioTrack.fromUrl('https://x/a.mp3', undefined).durationSeconds).toBeUndefined();
    expect(AudioTrack.fromUrl('https://x/a.mp3', 187.6).durationSeconds).toBe(188);
    expect(AudioTrack.fromUrl('https://x/a.mp3', 200).durationSeconds).toBe(200);
  });

  it('compares by value, not identity', () => {
    const a = AudioTrack.fromUrl('https://x/a.mp3', 100);
    const b = AudioTrack.fromUrl('https://x/a.mp3', 100);
    const c = AudioTrack.fromUrl('https://x/a.mp3', 101);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('serialises to a plain, JSON-safe shape', () => {
    expect(AudioTrack.fromUrl('https://x/a.mp3', 100).toJSON()).toEqual({
      url: 'https://x/a.mp3',
      durationSeconds: 100,
      mimeType: 'audio/mpeg',
    });
  });
});
