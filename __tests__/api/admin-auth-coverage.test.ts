/** @jest-environment node */
/**
 * Structural guard over the admin API surface.
 *
 * These assertions read the route sources rather than exercising handlers,
 * because the property worth protecting is "no admin route is EVER added
 * without auth" — a per-route behavioural test can only cover routes someone
 * remembered to write a test for, which is exactly the failure mode that let
 * `requireBearer` end up on roughly half the mutation routes.
 *
 * If a new route trips this, the fix is to add the guard, not to add an
 * exemption.
 */
import fs from 'fs';
import path from 'path';

const API_ROOT = path.join(process.cwd(), 'src/app/api');
const MUTATIONS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

interface Route {
  /** Route path as it appears in a URL, e.g. `admin/lexicon/bulk`. */
  name: string;
  source: string;
  methods: string[];
  /** Source text of each handler, keyed by HTTP method. */
  handlers: Record<string, string>;
}

function listRoutes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRoutes(full);
    return entry.name === 'route.ts' ? [full] : [];
  });
}

/** Split a route module into its per-method handler bodies. */
function splitHandlers(source: string): Record<string, string> {
  const starts = [
    ...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g),
  ].map((m) => ({ index: m.index!, method: m[1] }));

  const handlers: Record<string, string> = {};
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    handlers[start.method] = source.slice(start.index, end);
  });
  return handlers;
}

const routes: Route[] = listRoutes(API_ROOT).map((file) => {
  const source = fs.readFileSync(file, 'utf-8');
  const handlers = splitHandlers(source);
  return {
    name: path
      .relative(API_ROOT, file)
      .replace(/[\\/]route\.ts$/, '')
      .split(path.sep)
      .join('/'),
    source,
    methods: Object.keys(handlers),
    handlers,
  };
});

const adminRoutes = routes.filter((r) => r.name.startsWith('admin/'));

/** Routes authenticating the daily cron via a shared secret header. */
const isCronRoute = (r: Route) => r.source.includes('CRON_SECRET');

describe('admin API auth coverage', () => {
  it('finds the admin routes (guards against a broken glob silently passing)', () => {
    expect(adminRoutes.length).toBeGreaterThan(50);
  });

  it.each(adminRoutes.map((r) => [r.name, r] as const))(
    'admin/%s requires an authenticated admin',
    (_name, route) => {
      expect(route.source).toMatch(/requireAdmin/);
    }
  );

  const adminMutations = adminRoutes.flatMap((route) =>
    route.methods
      .filter((m) => (MUTATIONS as readonly string[]).includes(m))
      .map((method) => [`${route.name} [${method}]`, route, method] as const)
  );

  it('finds admin mutation handlers to check', () => {
    expect(adminMutations.length).toBeGreaterThan(20);
  });

  it.each(adminMutations)(
    '%s rejects cookie-only auth via requireBearer (CSRF defense-in-depth)',
    (_label, route, method) => {
      expect(route.handlers[method]).toMatch(/requireBearer\(/);
    }
  );

  it('applies the bearer requirement only alongside the admin check, never on the cron path', () => {
    // A cron caller presents `x-cron-secret`, not a Bearer token. Requiring a
    // bearer on that path would break the daily snapshot jobs — and it buys
    // nothing, since a custom header is not attacker-settable cross-origin.
    const cronRoutes = adminRoutes.filter(isCronRoute);
    expect(cronRoutes.length).toBeGreaterThan(0);

    for (const route of cronRoutes) {
      for (const method of MUTATIONS) {
        const handler = route.handlers[method];
        if (!handler?.includes('requireBearer')) continue;
        // The bearer check must sit inside the non-cron branch, which the
        // routes express as `if (!cronAuthorized(request)) { … }`.
        expect(handler).toMatch(/if \(!cronAuthorized\([\s\S]*?requireBearer\(/);
      }
    }
  });

  it('never gates a read-only GET behind requireBearer', () => {
    // GETs are not state-changing, so a bearer requirement there would break
    // ordinary session navigation for no security gain.
    const gettersWithBearer = adminRoutes
      .filter((r) => r.handlers.GET?.includes('requireBearer('))
      .map((r) => r.name);

    expect(gettersWithBearer).toEqual([]);
  });
});

describe('public API surface', () => {
  const publicRoutes = routes.filter((r) => !r.name.startsWith('admin/'));

  /**
   * Public endpoints that reach a paid third-party API or write to the
   * database. Each must be rate limited; an unmetered one is a cost or
   * spam vector. `poem-music` is here because it can reach Vertex AI.
   */
  const SPEND_OR_WRITE = [
    'ai/chat',
    'ai/search',
    'ai/analyze-poem',
    'tts/synthesize',
    'tts/context-aware',
    'poem-music',
    'contact',
    'subscribe',
    'push/subscribe',
    'events',
    'stories',
    'lyrics/unlock',
    'content/[id]/view',
  ];

  it.each(SPEND_OR_WRITE)('%s is rate limited', (name) => {
    const route = publicRoutes.find((r) => r.name === name);
    expect(route).toBeDefined();
    expect(route!.source).toMatch(/checkRateLimit|RateLimiter/);
  });

  it('keeps the debug/test routes unreachable in production', () => {
    for (const name of ['debug-env', 'test-db', 'table-schema', 'tts/debug', 'test/content']) {
      const route = routes.find((r) => r.name === name);
      expect(route).toBeDefined();
      // Either a hard 404 stub or an explicit production guard.
      expect(route!.source).toMatch(/'Not found'|NODE_ENV === 'production'/);
    }
  });
});
