/**
 * SlideshowFields — the times fill themselves in, and a blocked render says why.
 *
 * ⚠️ WHY THESE EXIST. Raj uploaded extra images and "could not click render"
 * (2026-10-01). The button was disabled because each image also needed a start
 * time typed in, and nothing on the screen said so: uploading an image looked
 * like it should be enough, and a greyed-out button gave no reason. A control
 * that is disabled without an explanation is a control that looks broken.
 */
import { spreadSlides, slidesProblem, type Slide } from '@/components/admin/SlideshowFields';

const empty = (): Slide => ({ key: null, name: null, at: '', auto: true });
const up = (n: number, at = '', auto = true): Slide => ({ key: `audio/mastering/${n}.png`, name: `${n}.png`, at, auto });

describe('start times fill themselves in', () => {
  it('spreads the images evenly across a song whose length is known', () => {
    // 6:00, cover + 2 added = 3 images → cuts at 2:00 and 4:00.
    expect(spreadSlides([empty(), empty()], 360).map((s) => s.at)).toEqual(['2:00', '4:00']);
  });

  it('re-spreads when another image is added', () => {
    const two = spreadSlides([empty()], 360);
    expect(two.map((s) => s.at)).toEqual(['3:00']);
    expect(spreadSlides([...two, empty()], 360).map((s) => s.at)).toEqual(['2:00', '4:00']);
  });

  it('never moves a time the operator typed', () => {
    const out = spreadSlides([up(2, '0:45', false), empty()], 360);
    expect(out[0].at).toBe('0:45');
    expect(out[1].at).toBe('4:00');
  });

  it('steps by half a minute when the length is not known', () => {
    expect(spreadSlides([empty(), empty()], null).map((s) => s.at)).toEqual(['0:30', '1:00']);
  });

  it('lands on whole seconds, so nothing odd is shown or sent', () => {
    for (const s of spreadSlides([empty(), empty()], 221.9)) expect(s.at).toMatch(/^\d+:\d\d$/);
  });
});

describe('a blocked render says why', () => {
  it('says nothing when every image is finished', () => {
    expect(slidesProblem([])).toBeNull();
    expect(slidesProblem([up(2, '1:30')])).toBeNull();
  });

  it('names the image with no file', () => {
    expect(slidesProblem([{ ...empty(), at: '1:30' }])).toMatch(/Image 2 has no file/);
  });

  it('names the image with no start time, and shows the format', () => {
    expect(slidesProblem([up(2, '1:00'), up(3, '')])).toMatch(/Image 3 needs a start time.*1:30/);
  });

  it('quotes a time it cannot read', () => {
    expect(slidesProblem([up(2, 'soon')])).toMatch(/Image 2.*“soon”/);
  });
});
