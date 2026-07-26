/**
 * ContentSidebar — related-content list on public content pages.
 *
 * The behaviour under test is a regression guard. This component used to fall
 * back, on ANY API failure, to a hardcoded "demo" table of invented songs and
 * poems attributed to real, named people — Ilaiyaraaja, A.R. Rahman,
 * Vairamuthu, Kannadasan — and to political figures, on a brand that is
 * deliberately apolitical. That shipped to visitors on every content page.
 *
 * Failing to an empty list is strictly better than failing to fiction, and the
 * component already renders a graceful empty state.
 */

import { readFileSync } from 'fs';
import { render, screen, waitFor } from '@testing-library/react';
import { ContentSidebar } from '@/components/ContentSidebar';

jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  return MockLink;
});

jest.mock('next/navigation', () => ({
  usePathname: () => '/content/cnt_1',
}));

/** Names that must never appear as fabricated attributions. */
const REAL_PEOPLE = [
  'இளையராஜா', // Ilaiyaraaja
  'ஏ.ஆர்.ரஹ்மான்', // A.R. Rahman
  'வைரமுத்து', // Vairamuthu
  'கண்ணதாசன்', // Kannadasan
  'கல்கி', // Kalki
  'பாரதியார்', // Bharathiyar
  'பெரியார்', // Periyar   — political
  'அண்ணா', // Anna      — political
  'கலைஞர்', // Kalaignar — political
];

const props = { currentId: 'cnt_1', currentType: 'SONGS', currentTitle: 'ஒரு பாடல்' };

describe('ContentSidebar', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders related content returned by the API', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: 'cnt_2', title: 'இரண்டாம் பாடல்', type: 'SONGS', author: 'Raj' }],
      }),
    }) as unknown as typeof fetch;

    render(<ContentSidebar {...props} />);

    await waitFor(() => {
      expect(screen.getByText('இரண்டாம் பாடல்')).toBeInTheDocument();
    });
  });

  describe('when the API fails', () => {
    it.each([
      [
        'a non-OK response',
        () => jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
      ],
      ['a thrown/network error', () => jest.fn().mockRejectedValue(new Error('network down'))],
    ])('shows the empty state rather than fabricated rows — %s', async (_label, makeFetch) => {
      global.fetch = makeFetch() as unknown as typeof fetch;

      render(<ContentSidebar {...props} />);

      await waitFor(() => {
        expect(screen.getByText('தொடர்புடைய உள்ளடக்கம் இல்லை')).toBeInTheDocument();
      });

      for (const name of REAL_PEOPLE) {
        expect(screen.queryByText(new RegExp(name))).not.toBeInTheDocument();
      }
    });
  });

  it('carries no hardcoded attribution to a real person anywhere in its source', () => {
    // Belt-and-braces: the render tests above only cover the SONGS branch, but
    // the removed table also had POEMS/LYRICS/STORIES/ESSAYS rows.
    const src = readFileSync('src/components/ContentSidebar.tsx', 'utf-8');

    for (const name of REAL_PEOPLE) {
      expect(src).not.toContain(name);
    }
    expect(src).not.toContain('getMockRelatedContent');
  });
});
