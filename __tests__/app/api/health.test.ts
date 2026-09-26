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
