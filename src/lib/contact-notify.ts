/**
 * Contact-form email notification (AWS SES v2).
 *
 * The submission is already persisted to DynamoDB before this runs, so email is
 * strictly BEST-EFFORT: callers MUST treat a throw here as non-fatal (never drop
 * a saved message because mail failed). Delivery is env-gated — with no
 * `CONTACT_NOTIFY_FROM` set this is a silent no-op, so local/dev and preview
 * builds don't attempt (and fail) to send.
 *
 * SES setup required before mail actually flows:
 *  - `CONTACT_NOTIFY_FROM` must be a VERIFIED SES identity in the app region.
 *  - In the SES sandbox, `CONTACT_NOTIFY_TO` must ALSO be verified (or the
 *    account must be granted production access).
 *  - The runtime IAM principal needs the `ses:SendEmail` permission.
 */
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { awsConfig } from '@/lib/aws-config';

/**
 * ⚠️ THESE ARE BUILT IN BECAUSE THE ENV VARS NEVER ARRIVE.
 *
 * Order notifications had never sent — not once. /api/health, probed against
 * the deployed site on 2026-09-26, reported `contactNotify: false`: **plain
 * Amplify environment variables do not reach the SSR runtime.** So
 * `CONTACT_NOTIFY_FROM` was empty in production and `sendContactNotification`
 * returned at its first line. Silently — nothing throws, so the caller's catch
 * never logged, and no signal reached anyone.
 *
 * The rest of the app survived this because every other load-bearing value
 * carries a hardcoded fallback (`'TamilWebContent'`, `'tamil-web-media'`).
 * This one fell back to `''`, which the code correctly reads as "unconfigured".
 *
 * ⚠️ SETTING THESE IN THE AMPLIFY CONSOLE DOES NOTHING AT RUNTIME. Raj changed
 * CONTACT_NOTIFY_TO there on 2026-09-26 and it had no effect — the recipient
 * kept falling back to the constant below. Change the constants here instead,
 * and redeploy.
 *
 * Not a secret: an SES sender must be a verified identity and the recipient is
 * the site owner, so both are ordinary configuration. The recipient was always
 * a constant; the sender is now one too.
 */
const DEFAULT_FROM = 'rajeswaran.t@techsynergy.ca';
const DEFAULT_TO = 'rajeswaran.t@techsynergy.ca';
const ADMIN_URL = 'https://tamilagaval.com/admin/messages';

// Read at call-time (not module load) so the env-gate reflects the current
// environment and tests can toggle configuration without module-cache games.
function config() {
  return {
    // ⚠️ The production fallback is GATED, not unconditional. "No sender => no
    // send" is a deliberate safety property: a preview build or a local dev
    // server must never deliver real mail to the owner's inbox. NODE_ENV is
    // set by Next itself rather than by the Amplify console, so unlike
    // CONTACT_NOTIFY_FROM it genuinely is present at runtime.
    from:
      process.env.CONTACT_NOTIFY_FROM?.trim() ||
      (process.env.NODE_ENV === 'production' ? DEFAULT_FROM : ''),
    to: process.env.CONTACT_NOTIFY_TO?.trim() || DEFAULT_TO,
  };
}

/** True when a verified sender is configured (i.e. mail will be attempted). */
export function isContactNotifyConfigured(): boolean {
  return config().from.length > 0;
}

let cachedClient: SESv2Client | null = null;
function client(): SESv2Client {
  if (!cachedClient) {
    cachedClient = new SESv2Client({
      region: awsConfig.region,
      ...(awsConfig.credentials && { credentials: awsConfig.credentials }),
    });
  }
  return cachedClient;
}

export interface ContactNotification {
  name: string;
  email: string;
  subject: string;
  message: string;
}

/**
 * Emails the site owner about a new submission.
 * @returns `true` if an email was dispatched, `false` if skipped (not configured).
 * @throws  if SES rejects the send — the caller is expected to swallow + log.
 */
export async function sendContactNotification(msg: ContactNotification): Promise<boolean> {
  const { from, to } = config();
  if (!from) return false; // not configured → no-op

  const isCommission = /music composition commission/i.test(msg.subject);
  const tag = isCommission ? '🎼 Commission' : '📬 Contact';
  const subjectLine = `${tag}: ${msg.subject} — ${msg.name}`;

  const text = [
    `New ${isCommission ? 'music composition commission' : 'contact'} message via tamilagaval.com`,
    '',
    `Name:    ${msg.name}`,
    `Email:   ${msg.email}`,
    `Subject: ${msg.subject}`,
    '',
    'Message:',
    msg.message,
    '',
    `Reply directly to this email to reach ${msg.name}.`,
    `View all messages: ${ADMIN_URL}`,
  ].join('\n');

  await client().send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      // So a plain "Reply" in the inbox goes straight to the person who wrote in.
      ReplyToAddresses: [msg.email],
      Content: {
        Simple: {
          Subject: { Data: subjectLine, Charset: 'UTF-8' },
          Body: { Text: { Data: text, Charset: 'UTF-8' } },
        },
      },
    })
  );
  return true;
}
