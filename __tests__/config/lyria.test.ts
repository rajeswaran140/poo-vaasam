/** @jest-environment node */
/**
 * The Lyria master switch guards real Vertex AI spend reachable from an
 * unauthenticated route, so the default matters as much as the happy path:
 * anything other than an explicit opt-in must leave generation OFF.
 */

const ENV = process.env;

/** Re-import the module fresh so the env is read at load time, as in production. */
const loadConfig = async (env: Record<string, string | undefined>) => {
  jest.resetModules();
  process.env = { ...ENV, ...env };
  return import('@/config/lyria');
};

afterEach(() => {
  process.env = ENV;
});

describe('Lyria configuration', () => {
  it('is DISABLED by default when LYRIA_ENABLED is unset', async () => {
    const { isLyriaEnabled, LYRIA } = await loadConfig({ LYRIA_ENABLED: undefined });

    expect(LYRIA.enabled).toBe(false);
    expect(isLyriaEnabled()).toBe(false);
  });

  it('is enabled only by the exact string "true"', async () => {
    const { isLyriaEnabled } = await loadConfig({ LYRIA_ENABLED: 'true' });

    expect(isLyriaEnabled()).toBe(true);
  });

  it.each(['', 'false', 'TRUE', '1', 'yes', 'true ', 'enabled'])(
    'stays disabled for the near-miss value %p, so a typo cannot switch on spend',
    async (value) => {
      const { isLyriaEnabled } = await loadConfig({ LYRIA_ENABLED: value });

      expect(isLyriaEnabled()).toBe(false);
    }
  );

  it('honours GOOGLE_VERTEX_PROJECT and otherwise falls back to the default project', async () => {
    const custom = await loadConfig({ GOOGLE_VERTEX_PROJECT: 'my-project' });
    expect(custom.LYRIA.project).toBe('my-project');

    const fallback = await loadConfig({ GOOGLE_VERTEX_PROJECT: '' });
    expect(fallback.LYRIA.project).toBe('webcore-dev');
  });
});
