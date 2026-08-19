/**
 * /admin/captions — dark-theme coverage.
 *
 * The page shipped with ZERO `dark:` variants, so on a dark admin shell
 * (AdminLayoutClient sets `dark:bg-gray-950`) its white cards and near-black
 * text rendered light-on-dark and dark-on-dark. Tailwind runs `darkMode:
 * 'class'`, so nothing warns about this — the classes are simply absent.
 *
 * This walks the rendered tree and asserts that any element painting a LIGHT
 * surface or a light-mode text colour also carries a `dark:` variant. It is
 * theme-mechanism-agnostic: it never toggles the theme, it checks that the
 * markup has something to say when the theme flips.
 */

const adminFetch = jest.fn();
jest.mock('@/lib/client-auth', () => ({ adminFetch: (...a: unknown[]) => adminFetch(...a) }));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CaptionsPage from '@/app/(admin)/admin/captions/page';

/** Classes that only make sense in light mode; each needs a dark counterpart. */
const LIGHT_ONLY =
  /(?:^|\s)(bg-white|bg-gray-(?:50|100|200)|text-gray-(?:400|500|600|700|800|900)|border-gray-(?:100|200)|divide-gray-100|bg-(?:amber|rose|red|emerald|green)-50|text-(?:amber|rose|red|emerald|green)-(?:600|700|800|900))(?:\s|$)/;

function lightOnlyElements(root: HTMLElement): string[] {
  const offenders: string[] = [];
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const cls = el.getAttribute('class') ?? '';
    if (LIGHT_ONLY.test(cls) && !cls.includes('dark:')) offenders.push(cls);
  });
  return offenders;
}

const SONGS = {
  success: true,
  ready: 2,
  songs: [
    { id: 's1', title: 'நீ சிரிச்ச நேரம்', youtubeVideoId: 'GXLu3Y7FghU', hasBody: true, cardCount: 12 },
    { id: 's2', title: 'no video song', youtubeVideoId: null, hasBody: false, cardCount: 0 },
  ],
};

const PREVIEW = {
  success: true,
  title: 'நீ சிரிச்ச நேரம்',
  videoId: 'GXLu3Y7FghU',
  asrCueCount: 40,
  totalLines: 12,
  anchoredLines: 9,
  interpolatedLines: 3,
  textPreserved: true,
  warnings: ['card 1 lands after 0:30'],
  cues: [
    { startMs: 1000, endMs: 4000, text: 'முதல் வரி', anchored: true },
    { startMs: 4000, endMs: 8000, text: 'இரண்டாம் வரி', anchored: false },
  ],
};

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  adminFetch.mockReset();
  adminFetch.mockImplementation((url: string) =>
    Promise.resolve(url.includes('/preview') ? ok(PREVIEW) : ok(SONGS))
  );
});

it('song list and banners have dark variants', async () => {
  const { container } = render(<CaptionsPage />);
  await screen.findByText('நீ சிரிச்ச நேரம்');
  expect(lightOnlyElements(container)).toEqual([]);
});

it('the preview pane has dark variants (text-preserved path)', async () => {
  const { container } = render(<CaptionsPage />);
  // Both songs render a button; only the first is enabled (s2 has no video).
  fireEvent.click((await screen.findAllByRole('button', { name: /Preview timings/ }))[0]);
  await screen.findByText(/preserved character-for-character/);
  expect(lightOnlyElements(container)).toEqual([]);
});

it('the preview pane has dark variants (text-CHANGED warning path)', async () => {
  adminFetch.mockImplementation((url: string) =>
    Promise.resolve(url.includes('/preview') ? ok({ ...PREVIEW, textPreserved: false }) : ok(SONGS))
  );
  const { container } = render(<CaptionsPage />);
  // Both songs render a button; only the first is enabled (s2 has no video).
  fireEvent.click((await screen.findAllByRole('button', { name: /Preview timings/ }))[0]);
  await screen.findByText(/do not publish this/);
  expect(lightOnlyElements(container)).toEqual([]);
});

it('the error banner has dark variants', async () => {
  adminFetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({ success: false, error: 'boom' }) });
  const { container } = render(<CaptionsPage />);
  await screen.findByText('boom');
  expect(lightOnlyElements(container)).toEqual([]);
});

it('the empty state has dark variants', async () => {
  adminFetch.mockResolvedValue(ok({ success: true, ready: 0, songs: [] }));
  const { container } = render(<CaptionsPage />);
  await screen.findByText('No songs found.');
  expect(lightOnlyElements(container)).toEqual([]);
});

it('the detector actually fires on a light-only class (guards the guard)', async () => {
  const { container } = render(<CaptionsPage />);
  await screen.findByText('நீ சிரிச்ச நேரம்');
  const probe = document.createElement('div');
  probe.setAttribute('class', 'rounded-lg border border-gray-200 bg-white');
  container.appendChild(probe);
  await waitFor(() => expect(lightOnlyElements(container)).toHaveLength(1));
});
