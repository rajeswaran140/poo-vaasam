/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { noteToSample, percussionSample, parseMidiJs, noteNameToMidi, samplerBuffers, SAMPLER_PARAMS, type LoadedPack } from '@/lib/studio-phase0/engine';

const buf = (id: string) => ({ id } as unknown as AudioBuffer);

describe('noteToSample', () => {
  const pack: LoadedPack = { packId: 'p', buffers: new Map([['60', buf('c4')], ['64', buf('e4')]]) };
  it('picks the nearest sample and returns the cents gap', () => {
    expect(noteToSample(pack, 63)).toEqual({ buffer: buf('e4'), detuneCents: -100 });
    expect(noteToSample(pack, 61)).toEqual({ buffer: buf('c4'), detuneCents: 100 });
    expect(noteToSample(pack, 60)).toEqual({ buffer: buf('c4'), detuneCents: 0 });
  });
  it('throws for a pack with no pitched samples', () => {
    expect(() => noteToSample({ packId: 'd', buffers: new Map([['low', buf('l')]]) }, 60)).toThrow(/no pitched samples/);
  });
});

describe('percussionSample', () => {
  const pack: LoadedPack = { packId: 'd', buffers: new Map([['low', buf('l')], ['high', buf('h')]]) };
  it('maps 48 to low and 72 to high, with 60 as the boundary', () => {
    expect(percussionSample(pack, 48)).toEqual(buf('l'));
    expect(percussionSample(pack, 72)).toEqual(buf('h'));
    expect(percussionSample(pack, 59)).toEqual(buf('l'));
    expect(percussionSample(pack, 60)).toEqual(buf('h'));
  });
});

describe('MIDI.js soundfont parsing', () => {
  it('converts note names, flats included, to MIDI numbers', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('A0')).toBe(21);
    expect(noteNameToMidi('Db4')).toBe(61);
    expect(noteNameToMidi('Bb3')).toBe(58);
    expect(noteNameToMidi('C8')).toBe(108);
    expect(noteNameToMidi('H2')).toBeNull();
  });

  it('decodes each data: URI into bytes keyed by MIDI number', () => {
    const js = 'if (typeof(MIDI) === "undefined") var MIDI = {};\nMIDI.Soundfont.flute = {\n"C4": "data:audio/mp3;base64,AAEC",\n"Db4": "data:audio/mp3;base64,/w==",\n}';
    const out = parseMidiJs(js);
    expect([...out.keys()]).toEqual([60, 61]);
    expect(Array.from(out.get(60)!)).toEqual([0, 1, 2]);
    expect(Array.from(out.get(61)!)).toEqual([255]);
  });

  it('never evaluates the file (no eval, no new Function)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/studio-phase0/engine.ts'), 'utf-8');
    expect(src).not.toMatch(/\beval\(|new Function/);
  });
});

it('engine.ts has no static import of tone or smplr', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/studio-phase0/engine.ts'), 'utf-8');
  expect(src).not.toMatch(/^import [^;]* from ['"](tone|smplr)['"]/m);
});

describe('samplerBuffers (final review C1)', () => {
  // smplr reads a key as MIDI only if it is a note NAME; "60" became alias 0,
  // so every straight note played the wrong sample or nothing. Pinned against
  // smplr's own converter, so a smplr upgrade that changes this fails here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { samplerToPreset } = require('smplr');
  // smplr tells a buffer from a URL with `instanceof AudioBuffer`, which Node lacks.
  class FakeAudioBuffer {}
  (global as unknown as { AudioBuffer: unknown }).AudioBuffer = FakeAudioBuffer;
  const ab = () => new FakeAudioBuffer() as unknown as AudioBuffer;
  const pack: LoadedPack = {
    packId: 'p',
    buffers: new Map([['48', ab()], ['52', ab()], ['60', ab()], ['61', ab()]]),
  };

  it('passes smplr finite defaults (unset options become NaN detune in Chrome)', () => {
    const { json } = samplerToPreset(samplerBuffers(pack), SAMPLER_PARAMS);
    for (const k of ['detune', 'ampRelease', 'lpfCutoffHz']) {
      expect(Number.isFinite(json.defaults[k])).toBe(true);
    }
  });

  it('keys every sample by note name', () => {
    expect(Object.keys(samplerBuffers(pack)).sort()).toEqual(['C#4', 'C3', 'C4', 'E3'].sort());
  });

  it('gives smplr pitch-spread regions at the samples’ real MIDI numbers', () => {
    const { json } = samplerToPreset(samplerBuffers(pack));
    const regions = json.groups.flatMap((g: { regions: Array<{ pitch: number; keyRange: [number, number] }> }) => g.regions);
    expect(regions.map((r: { pitch: number }) => r.pitch).sort()).toEqual([48, 52, 60, 61]);
    const covering62 = regions.filter((r: { keyRange: [number, number] }) => r.keyRange[0] <= 62 && 62 <= r.keyRange[1]);
    expect(covering62).toHaveLength(1);
    expect(covering62[0].pitch).toBe(61);
  });
});
