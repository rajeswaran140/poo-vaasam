/** @jest-environment node */
/**
 * /api/health reports whether the contact-notification sender is configured.
 *
 * ⚠️ WHY THIS EXISTS. Order notifications have never sent — /api/contact writes
 * to DynamoDB and returns 201, but SES shows no sends at all. The cause could
 * not be found from outside, and the two remaining candidates are
 * indistinguishable without asking the running app:
 *
 *   1. CONTACT_NOTIFY_FROM is not visible at RUNTIME, so
 *      sendContactNotification hits `if (!from) return false` and no-ops
 *      SILENTLY — nothing throws, so the caller's catch never logs.
 *   2. SES rejects the send and it IS logged — but the Amplify log group
 *      captures no application console output, so the log is invisible.
 *
 * The permission theory is already disproven: the runtime principal is the IAM
 * user `poo-vaasam-app-user`, which carries `ses:SendEmail` on `*` with no
 * conditions.
 *
 * This probe distinguishes them. It calls `isContactNotifyConfigured()` — the
 * SAME function the sender's own guard uses — so it cannot drift from the
 * behaviour it is reporting on. A boolean only: never the addresses.
 */
import { GET } from '@/app/api/health/route';
// Static, not require(): each helper reads process.env when CALLED, not at
// module load, so importing them up front still sees the per-test env.
import { isGA4Configured } from '@/lib/ga4-api';
import { isBigQueryConfigured } from '@/lib/bigquery-api';
import { isVapidConfigured } from '@/lib/push-broadcast';
import { isYouTubeApiConfigured } from '@/lib/youtube-api';

const ORIGINAL = process.env.CONTACT_NOTIFY_FROM;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CONTACT_NOTIFY_FROM;
  else process.env.CONTACT_NOTIFY_FROM = ORIGINAL;
});

const body = async () => (await GET()).json();

it('still reports basic liveness', async () => {
  expect(await body()).toEqual(expect.objectContaining({ status: 'ok' }));
});

it('reports whether the contact-notification sender is configured', async () => {
  expect(typeof (await body()).contactNotify).toBe('boolean');
});

/**
 * The load-bearing one. If this value were captured at module load or inlined
 * at build, the probe would report the BUILD environment and tell us nothing
 * about the runtime — which is the exact question being asked.
 */
it('reads the sender config at call time, not at module load', async () => {
  process.env.CONTACT_NOTIFY_FROM = '';
  expect((await body()).contactNotify).toBe(false);
  process.env.CONTACT_NOTIFY_FROM = 'notify@example.com';
  expect((await body()).contactNotify).toBe(true);
});

it('never leaks the addresses themselves', async () => {
  process.env.CONTACT_NOTIFY_FROM = 'secret-sender@example.com';
  expect(JSON.stringify(await body())).not.toContain('secret-sender');
});

/**
 * ⚠️ THE OTHER FIVE. CONTACT_NOTIFY_FROM was not special — it was just the
 * first one anybody noticed. Cross-referencing every `process.env` read in
 * src/ against Amplify's plain env vars found five more that are read at
 * runtime with NO fallback, so each fails the same silent way:
 *
 *   GA4_PROPERTY_ID          admin GA4 dashboard
 *   BIGQUERY_PROJECT_ID      BigQuery analytics
 *   VAPID_PUBLIC_KEY/SUBJECT web push (the PRIVATE key is in SSM, so it works)
 *   YOUTUBE_OAUTH_CLIENT_ID  YouTube ops (the SECRET is in SSM, so it works)
 *
 * NEXT_PUBLIC_* are exempt: Next inlines them into the bundle at build, so
 * they genuinely are present at runtime.
 *
 * The route reads env directly rather than importing each feature's
 * isXConfigured() — those live in modules that pull the BigQuery, GA4 and
 * web-push SDKs, which has no business in a health endpoint. The tests below
 * import the REAL helpers and assert the route agrees with every one of them,
 * so the cheap copy cannot drift from the guard it stands for.
 */
describe('config readiness reflects each feature\'s own guard', () => {
  const cases: [string, () => boolean, string[]][] = [
    ['ga4', isGA4Configured, ['GA4_PROPERTY_ID', 'GA4_SERVICE_ACCOUNT_KEY']],
    ['bigquery', isBigQueryConfigured, ['BIGQUERY_PROJECT_ID', 'GA4_PROPERTY_ID', 'BIGQUERY_SERVICE_ACCOUNT_KEY']],
    ['webPush', isVapidConfigured, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']],
    ['youtubeApi', isYouTubeApiConfigured, ['YOUTUBE_API_KEY']],
  ];

  it.each(cases)('%s — agrees when everything is set', async (flag, helper, vars) => {
    for (const v of vars) process.env[v] = 'set-for-test';
    const { config } = await body();
    expect({ flag, route: config[flag] }).toEqual({ flag, route: helper() });
    expect(config[flag]).toBe(true);
    for (const v of vars) delete process.env[v];
  });

  it.each(cases)('%s — agrees when one piece is missing', async (flag, helper, vars) => {
    for (const v of vars) process.env[v] = 'set-for-test';
    delete process.env[vars[0]];
    const { config } = await body();
    expect({ flag, route: config[flag] }).toEqual({ flag, route: helper() });
    expect(config[flag]).toBe(false);
    for (const v of vars) delete process.env[v];
  });
});

it('reports config as booleans only — never a value', async () => {
  process.env.GA4_PROPERTY_ID = 'properties/secret-id-12345';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = 'secret-client-id';
  const res = await body();
  for (const v of Object.values(res.config as Record<string, unknown>)) {
    expect(typeof v).toBe('boolean');
  }
  expect(JSON.stringify(res)).not.toContain('secret-id-12345');
  expect(JSON.stringify(res)).not.toContain('secret-client-id');
});

