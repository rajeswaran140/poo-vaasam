import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
    //
    // ⚠️ WAIT for the request carrying the FULL text — do not sample
    // `calls.at(-1)`. The component fires one request per keystroke, so the
    // most recent call at any instant is whichever prefix happened to be in
    // flight ("ma", "mal", …). The dropdown can already be showing results from
    // an earlier prefix, so the assertion could run before the final keystroke's
    // request was issued. That is exactly how this test passed locally and
    // failed the Amplify build on a slower machine, blocking a deploy.
    const urls = () => (global.fetch as jest.Mock).mock.calls.map((c) => String(c[0]));
    await waitFor(() => expect(urls().some((u) => u.includes('text=malai'))).toBe(true));

    const full = urls().find((u) => u.includes('text=malai'))!;
    expect(full).toContain('/api/admin/transliterate');
    const n = Number(new URL(full, 'https://x.test').searchParams.get('n'));
    expect(n).toBeGreaterThan(1);
  });
});
