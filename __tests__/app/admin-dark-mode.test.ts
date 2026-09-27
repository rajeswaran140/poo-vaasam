/** @jest-environment node */
/**
 * Dark-mode contrast guard for the admin.
 *
 * ⚠️ WHY THIS EXISTS. The admin genuinely supports dark mode — `darkMode:
 * 'class'`, a ThemeToggle in the shell, and the shell painting
 * `dark:bg-gray-950 dark:text-gray-100`. A page that INHERITS is fine. The bug
 * is a class list that OVERRIDES that inheritance without saying what should
 * happen in the dark: `text-gray-900` alone puts #111827 on #030712 — 1.2:1,
 * where AA wants 4.5:1. The heading simply vanishes.
 *
 * Found on /admin/songs 2026-09-27, then immediately on nine more pages, then
 * on 48 components once the ratios were actually computed rather than eyeballed.
 * That is the same shape as the route-metadata guard next door: fixing one page
 * only makes the next one visible. So this checks every admin page AND every
 * admin component at once.
 *
 * ⚠️ IT COMPUTES THE RATIO — it does not merely check that a `dark:` variant
 * exists. An earlier version of this fix added `dark:text-gray-500` in two
 * places, which LOOKS correct and is 3.67:1: still a fail. Presence is not
 * contrast.
 *
 * ⚠️ AND IT CHECKS BACKGROUNDS, because text alone was not enough. The first
 * version of this guard assumed every element sat on the dark shell. It did
 * not: `bg-white` with no `dark:` variant stays WHITE when the theme flips, so
 * lightening the text for dark mode put near-white text on a white box. That
 * regression shipped, and Raj found it — "some text is unreadable because the
 * background remains light." A light surface with no dark variant is therefore
 * a failure in its own right, independent of any ratio.
 *
 * STATIC ANALYSIS, ON PURPOSE. Importing every admin page would drag in
 * ContentRepository, the AWS SDK and a mock per route; the property is visible
 * in the text.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import colors from 'tailwindcss/colors';

const ROOTS = [
  join(process.cwd(), 'src', 'app', '(admin)'),
  join(process.cwd(), 'src', 'components', 'admin'),
];

/** The shell's dark ground, and the card that sits on it. */
const SHELL = '#030712'; // gray-950
/** Cards are gray-900; light text has LESS contrast there, so assume the card. */
const CARD = '#111827';
const AA = 4.5;

type Palette = Record<string, string | Record<string, string>>;

function hexFor(token: string): string | null {
  if (token === 'white') return '#ffffff';
  if (token === 'black') return '#000000';
  const m = /^([a-z]+)-(\d+)$/.exec(token);
  if (!m) return null;
  const group = (colors as unknown as Palette)[m[1]];
  if (!group || typeof group === 'string') return null;
  const hex = group[m[2]];
  return typeof hex === 'string' ? hex : null;
}

const channels = (hex: string): number[] =>
  [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => linear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** A `/NN` opacity means the colour is composited, not solid. */
function over(fg: string, bg: string, alpha: number): string {
  const [r1, g1, b1] = channels(fg);
  const [r2, g2, b2] = channels(bg);
  const mix = (x: number, y: number) =>
    Math.round(x * alpha + y * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) tsxFiles(full, out);
    else if (e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const LIGHT_SURFACE =
  /(?:^|[\s"`])bg-(?:white|(?:gray|slate|zinc|neutral|stone|red|green|blue|amber|orange|purple|emerald|rose|yellow|indigo|sky|teal)-(?:50|100|200))\b/;

interface Offence {
  cls: string;
  fg: string;
  ratio: number;
}

function offences(src: string): Offence[] {
  const found: Offence[] = [];
  for (const cls of src.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) ?? []) {
    // Effective dark-mode colour: the dark: variant when present, otherwise the
    // plain one — which still applies once the theme flips.
    const dark = /dark:text-([a-z]+-\d+|white|black)\b/.exec(cls);
    const plain = /(?:^|[\s"`])text-([a-z]+-\d+|white|black)\b/.exec(cls);
    const token = dark ?? plain;
    if (!token) continue;
    const fg = hexFor(token[1]);
    if (!fg) continue;

    // A light surface with no dark: variant is reported by the dedicated test
    // below; scoring it here against the dark card would measure a ground it
    // never actually has.
    if (LIGHT_SURFACE.test(cls) && !/dark:bg-/.test(cls)) continue;

    // Effective dark-mode ground: the dark: variant when present, else the
    // inherited card. A plain SOLID background (a brand button, say) renders
    // identically in both themes — its contrast is a general accessibility
    // question, not a dark-mode one, and is deliberately out of scope here.
    const bgMatch = /dark:bg-([a-z]+-\d+|white|black)(?:\/(\d+))?\b/.exec(cls);
    let bg = CARD;
    if (bgMatch) {
      const solid = hexFor(bgMatch[1]);
      if (solid) {
        const alpha = bgMatch[2] === undefined ? 1 : Number(bgMatch[2]) / 100;
        bg = alpha >= 1 ? solid : over(solid, SHELL, alpha);
      }
    }

    const ratio = contrast(fg, bg);
    if (ratio < AA) found.push({ cls: cls.slice(0, 90), fg: token[1], ratio });
  }
  return found;
}

describe('every admin surface stays readable in dark mode', () => {
  const files = ROOTS.flatMap((r) => tsxFiles(r)).sort();

  it('finds the admin surfaces to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((f) => [relative(process.cwd(), f), f]))(
    '%s meets AA 4.5:1 on the dark ground',
    (_name, file) => {
      const bad = offences(readFileSync(file, 'utf8'));
      // Reported with the ratio so a failure says WHY, not just that it failed.
      expect(bad.map((o) => `${o.fg} = ${o.ratio.toFixed(2)}:1 — ${o.cls}`)).toEqual([]);
    }
  );
});

describe('no admin surface stays light when the theme goes dark', () => {
  const files = ROOTS.flatMap((r) => tsxFiles(r)).sort();

  it.each(files.map((f) => [relative(process.cwd(), f), f]))(
    '%s pairs every light background with a dark: variant',
    (_name, file) => {
      const src = readFileSync(file, 'utf8');
      const stranded = (src.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) ?? [])
        .filter((cls) => LIGHT_SURFACE.test(cls) && !/dark:bg-/.test(cls))
        .map((cls) => cls.slice(0, 90));
      expect(stranded).toEqual([]);
    }
  );
});

describe('the contrast maths itself', () => {
  it('matches known WCAG pairs', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#030712', '#030712')).toBeCloseTo(1, 5);
  });

  it('rates the bug that started this as a failure', () => {
    // gray-900 on gray-950 — the /admin/songs heading before the fix.
    expect(contrast('#111827', '#030712')).toBeLessThan(1.5);
  });

  it('rates gray-500 on a dark card as below AA, which presence checks miss', () => {
    expect(contrast('#6b7280', CARD)).toBeLessThan(AA);
    expect(contrast('#9ca3af', CARD)).toBeGreaterThan(AA);
  });

  it('rates the regression this guard missed: light text left on a white box', () => {
    // gray-100 on white — what `dark:text-gray-100` did to a `bg-white` card
    // that had no dark: variant.
    expect(contrast('#f3f4f6', '#ffffff')).toBeLessThan(1.2);
  });
});
