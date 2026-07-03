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
    expect(input.Destination.ToAddresses).toEqual(['rajeswaran.pro@gmail.com']);
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
