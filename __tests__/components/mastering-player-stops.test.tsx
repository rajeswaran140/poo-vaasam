/** @jest-environment jsdom */
/**
 * MasteringPlayer stops playing when it goes away.
 *
 * ⚠️ WHY THIS EXISTS. Removing an <audio> element from the DOM does NOT
 * reliably stop it — a detached media element keeps playing until it is
 * collected. MasteringPlayer is keyed on the master URL, so switching rows in
 * the library unmounts one player and mounts the next. The previous master
 * carried on playing underneath the new one, which is heard as the library
 * advancing to another song by itself, and could not be stopped by anything on
 * screen because the element those controls talked to no longer existed.
 *
 * Reported 2026-09-21: "the player automatically advances to the next song
 * unless manually stopped".
 *
 * jsdom does not implement playback, so these assert the CONTRACT — the
 * element is paused as the component goes away — which is the thing that was
 * missing. MasteringComparePlayer has always done this; this one did not.
 */
import { render } from '@testing-library/react';
import { MasteringPlayer } from '@/components/admin/MasteringPlayer';

/** jsdom throws "Not implemented" from play/pause; count the calls instead. */
let pauseSpy: jest.SpyInstance;
let playSpy: jest.SpyInstance;

beforeEach(() => {
  pauseSpy = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  playSpy = jest
    .spyOn(HTMLMediaElement.prototype, 'play')
    .mockImplementation(() => Promise.resolve());
});
afterEach(() => {
  pauseSpy.mockRestore();
  playSpy.mockRestore();
});

const props = {
  masterUrl: 'https://s3/master-a.wav?sig=1',
  sourceUrl: null,
  title: 'ஈழத்து மண்ணே',
  afterTp: -1,
};

describe('a player that goes away stops playing', () => {
  it('pauses its audio element on unmount', () => {
    const { unmount } = render(<MasteringPlayer {...props} />);
    expect(pauseSpy).not.toHaveBeenCalled();

    unmount();

    expect(pauseSpy).toHaveBeenCalled();
  });

  /**
   * The library switches rows by changing `key`, which is an unmount + mount,
   * not a prop update. This is the path that actually produced the symptom.
   */
  it('pauses the previous master when the row is switched', () => {
    const { rerender } = render(<MasteringPlayer key="a" {...props} />);
    expect(pauseSpy).not.toHaveBeenCalled();

    rerender(
      <MasteringPlayer key="b" {...props} masterUrl="https://s3/master-b.wav?sig=2" />
    );

    expect(pauseSpy).toHaveBeenCalled();
  });

  it('does not pause while it is simply re-rendered', () => {
    const { rerender } = render(<MasteringPlayer key="a" {...props} />);
    rerender(<MasteringPlayer key="a" {...props} title="renamed" />);
    expect(pauseSpy).not.toHaveBeenCalled();
  });
});
