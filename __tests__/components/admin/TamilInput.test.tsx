import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TamilInput } from '@/components/admin/TamilInput';

// Our same-origin proxy (/api/admin/transliterate) shape for "malai" — includes
// மழை alongside மலை. (The proxy parses Google Input Tools server-side; the
// browser only ever sees this {candidates} JSON.)
const MALAI_RESPONSE = {
  success: true,
  candidates: ['மலை', 'மாலை', 'மழை', 'மலாய்', 'மேலை', 'மாழை'],
};

function Harness() {
  const [v, setV] = useState('');
  return <TamilInput value={v} onChange={setV} label="Title" />;
}

describe('TamilInput transliteration suggestions', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => MALAI_RESPONSE }) as Response);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows multiple candidates (மலை AND மழை) when typing "malai"', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'malai');

    // The dropdown surfaces several candidates, not just the top one.
    expect(await screen.findByText('மலை')).toBeInTheDocument();
    expect(await screen.findByText('மழை')).toBeInTheDocument();
    expect(await screen.findByText('மாலை')).toBeInTheDocument();

    // It hit our same-origin proxy (NOT Google directly) and asked for >1 option.
    const url = String((global.fetch as jest.Mock).mock.calls.at(-1)?.[0]);
    expect(url).toContain('/api/admin/transliterate');
    expect(url).toContain('text=malai');
    const n = Number(new URL(url, 'https://x.test').searchParams.get('n'));
    expect(n).toBeGreaterThan(1);
  });
});
