/** @jest-environment node */
/**
 * Guards that AWS credentials never leak into the client-facing config objects
 * (`cognitoConfig`, `amplifyConfig`), which can be imported by client components.
 */

describe('aws-config credential isolation', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('keeps AWS credentials out of cognitoConfig and amplifyConfig even when set', () => {
    process.env.NEXT_PUBLIC_APP_AWS_ACCESS_KEY_ID = 'AKIATESTLEAK000000';
    process.env.NEXT_PUBLIC_APP_AWS_SECRET_ACCESS_KEY = 'secretLEAKvalue123';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('@/lib/aws-config');

    for (const obj of [cfg.cognitoConfig, cfg.amplifyConfig]) {
      const serialized = JSON.stringify(obj);
      expect(serialized).not.toContain('AKIATESTLEAK000000');
      expect(serialized).not.toContain('secretLEAKvalue123');
    }
  });

  it('does still expose credentials on the server-only config (sanity check)', () => {
    process.env.APP_AWS_ACCESS_KEY_ID = 'AKIASERVERONLY00000';
    process.env.APP_AWS_SECRET_ACCESS_KEY = 'serverSecret456';

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cfg = require('@/lib/aws-config');
    expect(cfg.s3Config.credentials?.accessKeyId).toBe('AKIASERVERONLY00000');
  });
});
