import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TamilInput } from '@/components/admin/TamilInput';

// Google Input Tools response for "malai" — includes மழை (3rd) alongside மலை.
const MALAI = [
  'SUCCESS',
  [['malai', ['மலை', 'மாலை', 'மழை', 'மலாய்', 'மேலை', 'மாழை'], [], { candidate_type: [0, 0, 0, 0, 0, 0] }]],
];

function Harness() {
  const [v, setV] = useState('');
  return <TamilInput value={v} onChange={setV} label="Title" />;
}

describe('TamilInput transliteration suggestions', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ json: async () => MALAI }) as Response);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows multiple candidates (மலை AND மழை) when typing "malai"', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'malai');

    // The suggestion dropdown should surface several candidates, not just the top one.
    expect(await screen.findByText('மலை')).toBeInTheDocument();
    expect(await screen.findByText('மழை')).toBeInTheDocument();
    expect(await screen.findByText('மாலை')).toBeInTheDocument();

    // It requested more than one option from the engine.
    const url = (global.fetch as jest.Mock).mock.calls.at(-1)?.[0] as string;
    const num = Number(new URL(url).searchParams.get('num'));
    expect(num).toBeGreaterThan(1);
  });
});
