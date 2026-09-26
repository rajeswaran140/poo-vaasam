/** @jest-environment node */
/**
 * Route-wide metadata guards.
 *
 * ⚠️ WHY THIS EXISTS. Two audits eight days apart each found the same two
 * defects on a different page — /karaoke on 2026-09-18 (PR #355), /shorts on
 * 2026-09-26. Neither was a regression; they were always there, and fixing one
 * page only made the next one visible. Auditing page by page finds these two at
 * a time forever. Both are structural, so a test finds all of them at once:
 *
 *   no og:image   /shorts, /songs/love, /songs/mother, /songs/nature, /songs/homeland
 *   brand twice   /shorts, /support
 *
 * STATIC ANALYSIS, ON PURPOSE — it reads the source rather than importing it.
 * Importing every page would drag in ContentRepository, the AWS SDK and a mock
 * per route; the two properties checked here are visible in the text.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

const APP = join(process.cwd(), 'src', 'app');
const BRAND = /Tamilagaval|SITE_NAME/i;

/** Admin lives behind auth and is noindex — its titles are never shared or indexed. */
const isAdmin = (route: string) => route.startsWith('/admin');

/** Every page.tsx under src/app. `globSync` is Node 22+; this box runs 20. */
function pageFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) pageFiles(full, out);
    else if (e.name === 'page.tsx') out.push(full);
  }
  return out;
}

function routes(): { route: string; file: string; dir: string; src: string }[] {
  return pageFiles(APP).sort().map((file) => {
    const dir = dirname(file);
    let route = '/' + relative(APP, dir).split(sep).join('/');
    route = route.replace(/\/\([^)]*\)/g, '') || '/';
    if (route === '/.' || route === '') route = '/';
    return { route, file, dir, src: readFileSync(file, 'utf8') };
  });
}

/**
 * Resolve `const NAME = '…'` declared in the same file, so `title: META_TITLE`
 * is checkable rather than skipped.
 *
 * ⚠️ The first version required a colon AND an equals (`[:=][^=]*=`), which
 * matches `const X: string = '…'` but NOT the plain `const X = '…'` that every
 * page actually uses — so it silently resolved nothing and /shorts passed a
 * test it should have failed. The type annotation is optional here.
 */
function resolveConst(src: string, expr: string): string {
  const ident = expr.trim().replace(/,$/, '');
  if (/^['"`]/.test(ident)) return ident;
  if (!/^[A-Za-z_$][\w$]*$/.test(ident)) return ident; // not a bare identifier
  const m = src.match(
    new RegExp(`const\\s+${ident}\\s*(?::[^=]+)?=\\s*(['"\`])([\\s\\S]*?)\\1`)
  );
  return m ? m[2] : ident;
}

describe('every route serves a share image', () => {
  /**
   * Declaring `openGraph` in page metadata REPLACES the root layout's block
   * wholesale. If that block carries no `images` and the route ships no
   * co-located opengraph-image, the page serves NO og:image at all — verified
   * live on /karaoke before #355 and on /shorts and every /songs/<theme>.
   * /contact keeps the site card precisely because it declares no openGraph.
   */
  it.each(routes().filter((r) => !isAdmin(r.route)).map((r) => [r.route, r] as const))(
    '%s',
    (_route, r) => {
      const declaresOg = /\bopenGraph\s*:/.test(r.src);
      if (!declaresOg) return; // inherits the root's openGraph, image included

      const hasImages = /\bimages\s*:/.test(r.src);
      const hasCard = ['.tsx', '.ts', '.jsx', '.js'].some((e) =>
        existsSync(join(r.dir, `opengraph-image${e}`))
      );
      // Asserted as an object so a failure names the route and says which of
      // the two escape hatches was missing, rather than just "false !== true".
      expect({ route: r.route, servesShareImage: hasImages || hasCard, hasImages, hasCard })
        .toEqual({ route: r.route, servesShareImage: true, hasImages, hasCard });
    }
  );
});

describe('no route prints the brand twice in its title', () => {
  /**
   * The root layout appends it: `title: { template: '%s | Tamilagaval' }`. A
   * page whose own title also contains the brand therefore ships it twice —
   * "… | Tamilagaval | Tamilagaval" on /karaoke, and in two different spellings
   * on /shorts ("… — TamilAgaval | Tamilagaval").
   *
   * `title: { absolute: … }` opts out of the template, so such a title SHOULD
   * carry the brand and is exempt.
   */
  it.each(routes().filter((r) => !isAdmin(r.route)).map((r) => [r.route, r] as const))(
    '%s',
    (_route, r) => {
      const m = r.src.match(/^\s{2}title:\s*(.+)$/m);
      if (!m) return;                       // dynamic or absent — not checkable here
      if (/absolute/.test(m[1])) return;    // deliberately bypasses the template
      const title = resolveConst(r.src, m[1]);
      expect({ route: r.route, title, brandInOwnTitle: BRAND.test(title) })
        .toEqual({ route: r.route, title, brandInOwnTitle: false });
    }
  );
});
