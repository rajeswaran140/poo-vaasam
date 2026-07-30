/** @jest-environment jsdom */
/**
 * MasteringEqualizer — the non-destructive guarantees.
 *
 * The mastering module promises "loudness only, never tone". A monitoring EQ
 * sitting next to that promise is only safe if it can never be mistaken for the
 * delivered file, so these tests pin the two things that carry it: it starts
 * flat, and it says so loudly whenever it is not.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { MasteringEqualizer } from '@/components/admin/MasteringEqualizer';

/** jsdom has no Web Audio; a minimal fake lets the graph code run. */
function installAudioContext() {
  const gainNodes: Array<{ gain: { value: number }; frequency: { value: number } }> = [];
  class FakeFilter {
    type = '';
    frequency = { value: 0 };
    Q = { value: 0 };
    gain = { value: 0 };
    connect() {}
  }
  class FakeCtx {
    destination = {};
    createMediaElementSource() {
      return { connect: () => {} };
    }
    createBiquadFilter() {
      const f = new FakeFilter();
      gainNodes.push(f as unknown as { gain: { value: number }; frequency: { value: number } });
      return f;
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  return gainNodes;
}

const audioEl = () => document.createElement('audio');

beforeEach(() => {
  installAudioContext();
});

describe('the non-destructive guarantee', () => {
  it('starts FLAT — the first thing heard is always the real master', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    expect(screen.queryByText(/Not the master/i)).not.toBeInTheDocument();
  });

  it('warns the moment it is not flat, and names the bands', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    fireEvent.change(screen.getByLabelText('Low 60 Hz'), { target: { value: '5' } });
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent(/Not the master/i);
    expect(warning).toHaveTextContent(/Low 60 Hz \+5 dB/);
  });

  it('warns for a CUT as well as a boost', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    fireEvent.change(screen.getByLabelText('High 12 kHz'), { target: { value: '-3' } });
    expect(screen.getByRole('status')).toHaveTextContent(/High 12 kHz −3 dB/);
  });

  it('states that the file is untouched', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    expect(screen.getByText(/Monitoring only/i)).toBeInTheDocument();
    expect(screen.getByText(/never the file/i)).toBeInTheDocument();
  });

  it('reset returns to flat and clears the warning', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    fireEvent.change(screen.getByLabelText('Mid 1 kHz'), { target: { value: '8' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reset to flat/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('disables reset when already flat, so it cannot imply un-applied changes', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    expect(screen.getByRole('button', { name: /Reset to flat/i })).toBeDisabled();
  });
});

describe('presets', () => {
  it('offers Flat first', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    expect(screen.getByRole('button', { name: 'Flat' })).toBeInTheDocument();
  });

  it('a non-flat preset triggers the warning', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    fireEvent.click(screen.getByRole('button', { name: /Phone speaker/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/Not the master/i);
  });

  it('choosing Flat clears it again', () => {
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k1" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    fireEvent.click(screen.getByRole('button', { name: /Earbuds/i }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flat' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('graceful failure', () => {
  it('says the equaliser is unavailable rather than playing silently', () => {
    class Throwing {
      destination = {};
      createMediaElementSource() {
        throw new Error('MediaElementAudioSource outputs zeroes due to CORS access restrictions');
      }
      createBiquadFilter() {
        return {};
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = Throwing;
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k2" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    expect(screen.getByText(/cross-origin playback/i)).toBeInTheDocument();
  });

  it('handles a browser with no Web Audio at all', () => {
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
    render(<MasteringEqualizer audio={audioEl()} sourceKey="k3" />);
    fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));
    expect(screen.getByText(/no Web Audio support/i)).toBeInTheDocument();
  });

  it('renders without an audio element without throwing', () => {
    render(<MasteringEqualizer audio={null} sourceKey="k4" />);
    expect(screen.getByRole('button', { name: /Equaliser/i })).toBeInTheDocument();
  });
});
