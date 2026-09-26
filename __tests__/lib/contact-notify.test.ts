/** @jest-environment node */
/**
 * Unit tests — src/lib/contact-notify.ts (SES email notification).
 * Covers the env-gate (no-op when unconfigured), the SendEmail command shape,
 * reply-to routing, and the commission-vs-contact subject tagging.
 */

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  // Capture the command input so we can assert on it.
  SendEmailCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import {
  sendContactNotification,
  isContactNotifyConfigured,
} from '@/lib/contact-notify';
import { SendEmailCommand } from '@aws-sdk/client-sesv2';

const OLD_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  mockSend.mockResolvedValue({ MessageId: 'test-id' });
});

afterAll(() => {
  process.env = OLD_ENV;
});

const msg = {
  name: 'Priya',
  email: 'priya@example.com',
  subject: 'Music Composition Commission',
  message: 'Please set my lyrics to a melody.',
};

describe('env-gate', () => {
  it('is a no-op (returns false, sends nothing) when CONTACT_NOTIFY_FROM is unset', async () => {
    delete process.env.CONTACT_NOTIFY_FROM;
    expect(isContactNotifyConfigured()).toBe(false);
    const sent = await sendContactNotification(msg);
    expect(sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('is configured once a sender is set', () => {
    process.env.CONTACT_NOTIFY_FROM = 'noreply@tamilagaval.com';
    expect(isContactNotifyConfigured()).toBe(true);
  });
});

/**
 * ⚠️ WHY A BUILT-IN PRODUCTION SENDER EXISTS.
 *
 * Order notifications had NEVER sent. /api/health reported
 * `contactNotify: false` against the deployed site: plain Amplify environment
 * variables do not reach the SSR runtime, so `CONTACT_NOTIFY_FROM` was empty
 * there and this module returned false at its first line — silently, since
 * nothing throws and the caller's catch never fires.
 *
 * The site survived because every other load-bearing value has a hardcoded
 * fallback (`'TamilWebContent'`, `'tamil-web-media'`). This one fell back to
 * `''`, which the code reads as "not configured".
 *
 * So production now falls back to a built-in sender, exactly as the recipient
 * already did. NOT unconditionally: the dev/preview no-op is a deliberate
 * safety property — a preview build must not send real mail — so the fallback
 * is gated on NODE_ENV, which Next sets itself and which therefore does reach
 * the runtime.
 */
describe('production sender fallback', () => {
  const NODE_ENV = process.env.NODE_ENV;
  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: NODE_ENV, configurable: true });
  });
  const setEnv = (v: string) =>
    Object.defineProperty(process.env, 'NODE_ENV', { value: v, configurable: true });

  it('sends in production even with no CONTACT_NOTIFY_FROM, since the env var never arrives', async () => {
    delete process.env.CONTACT_NOTIFY_FROM;
    setEnv('production');
    expect(isContactNotifyConfigured()).toBe(true);
    expect(await sendContactNotification(msg)).toBe(true);
    const input = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.FromEmailAddress).toBe('rajeswaran.t@techsynergy.ca');
  });

  it('STILL no-ops outside production, so previews and local dev never send real mail', async () => {
    delete process.env.CONTACT_NOTIFY_FROM;
    setEnv('development');
    expect(isContactNotifyConfigured()).toBe(false);
    expect(await sendContactNotification(msg)).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('an explicit sender still wins over the built-in one', async () => {
    process.env.CONTACT_NOTIFY_FROM = 'override@example.com';
    setEnv('production');
    await sendContactNotification(msg);
    const input = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.FromEmailAddress).toBe('override@example.com');
  });
});

describe('sending', () => {
  beforeEach(() => {
    process.env.CONTACT_NOTIFY_FROM = 'noreply@tamilagaval.com';
    delete process.env.CONTACT_NOTIFY_TO; // exercise the default recipient
  });

  it('sends to the default owner inbox, from the configured sender, reply-to the requester', async () => {
    const sent = await sendContactNotification(msg);
    expect(sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.FromEmailAddress).toBe('noreply@tamilagaval.com');
    expect(input.Destination.ToAddresses).toEqual(['rajeswaran.t@techsynergy.ca']);
    expect(input.ReplyToAddresses).toEqual(['priya@example.com']);
  });

  it('honors a CONTACT_NOTIFY_TO override', async () => {
    process.env.CONTACT_NOTIFY_TO = 'someone@else.com';
    await sendContactNotification(msg);
    const input = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.Destination.ToAddresses).toEqual(['someone@else.com']);
  });

  it('tags commission requests distinctly in the subject line', async () => {
    await sendContactNotification(msg);
    const input = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.Content.Simple.Subject.Data).toMatch(/Commission/);
    expect(input.Content.Simple.Subject.Data).toContain('Priya');
  });

  it('tags a generic contact message differently', async () => {
    await sendContactNotification({ ...msg, subject: 'Just saying hello' });
    const input = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(input.Content.Simple.Subject.Data).toMatch(/Contact/);
    expect(input.Content.Simple.Subject.Data).not.toMatch(/Commission/);
  });

  it('includes the sender details and message body in the email text', async () => {
    await sendContactNotification(msg);
    const input = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    const text = input.Content.Simple.Body.Text.Data as string;
    expect(text).toContain('priya@example.com');
    expect(text).toContain('Please set my lyrics to a melody.');
  });

  it('propagates a SES failure to the caller (so the route can log it)', async () => {
    mockSend.mockRejectedValueOnce(new Error('Throttled'));
    await expect(sendContactNotification(msg)).rejects.toThrow('Throttled');
  });
});
