/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import { noteToSample, percussionSample, parseMidiJs, noteNameToMidi, type LoadedPack } from '@/lib/studio-phase0/engine';

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
