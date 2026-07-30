/** @jest-environment jsdom */
/**
 * MasteringEqualizer — the non-destructive guarantees.
 *
 * The mastering module promises "loudness only, never tone". A monitoring EQ
 * sitting next to that promise is only safe if it can never be mistaken for the
 * delivered file, so these tests pin the two things that carry it: it starts
 * flat, and it says so loudly whenever it is not.
 *
 * The component is presentational — the player owns the audio graph — so these
 * are pure interaction tests with no Web Audio involved.
 */

import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MasteringEqualizer } from '@/components/admin/MasteringEqualizer';
import { flatGains, type EqGains } from '@/lib/audio-eq';

/** Host that holds the gains, the way the player does. */
function Host({ unavailable = null }: { unavailable?: string | null }) {
  const [gains, setGains] = useState<EqGains>(flatGains);
  return <MasteringEqualizer gains={gains} onChange={setGains} unavailable={unavailable} />;
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /Equaliser/i }));

describe('the non-destructive guarantee', () => {
  it('starts FLAT — the first thing heard is always the real master', () => {
    render(<Host />);
    expect(screen.queryByText(/Not the master/i)).not.toBeInTheDocument();
  });

  it('warns the moment it is not flat, and names the band', () => {
    render(<Host />);
    open();
    fireEvent.change(screen.getByLabelText('Low 60 Hz'), { target: { value: '5' } });
    const warning = screen.getByRole('status');
    expect(warning).toHaveTextContent(/Not the master/i);
    expect(warning).toHaveTextContent(/Low 60 Hz \+5 dB/);
  });

  it('warns for a CUT as well as a boost', () => {
    render(<Host />);
    open();
    fireEvent.change(screen.getByLabelText('High 12 kHz'), { target: { value: '-3' } });
    expect(screen.getByRole('status')).toHaveTextContent(/High 12 kHz −3 dB/);
  });

  it('states that the file is untouched', () => {
    render(<Host />);
    open();
    expect(screen.getByText(/Monitoring only/i)).toBeInTheDocument();
    expect(screen.getByText(/never the file/i)).toBeInTheDocument();
  });

  it('reset returns to flat and clears the warning', () => {
    render(<Host />);
    open();
    fireEvent.change(screen.getByLabelText('Mid 1 kHz'), { target: { value: '8' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Reset to flat/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('disables reset when already flat, so it cannot imply un-applied changes', () => {
    render(<Host />);
    open();
    expect(screen.getByRole('button', { name: /Reset to flat/i })).toBeDisabled();
  });
});

describe('presets', () => {
  it('offers Flat first', () => {
    render(<Host />);
    open();
    expect(screen.getByRole('button', { name: 'Flat' })).toBeInTheDocument();
  });

  it('a non-flat preset triggers the warning', () => {
    render(<Host />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /Phone speaker/i }));
    expect(screen.getByRole('status')).toHaveTextContent(/Not the master/i);
  });

  it('choosing Flat clears it again', () => {
    render(<Host />);
    open();
    fireEvent.click(screen.getByRole('button', { name: /Earbuds/i }));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Flat' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('when the graph could not be built', () => {
  it('says so instead of showing controls that do nothing', () => {
    render(<Host unavailable="The audio source did not allow cross-origin playback" />);
    open();
    expect(screen.getByText(/cross-origin playback/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Low 60 Hz')).not.toBeInTheDocument();
  });
});
