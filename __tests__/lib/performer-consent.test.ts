/** @jest-environment node */
/**
 * recordPerformerConsent — the durable, IMMUTABLE consent record. Proves a
 * first acceptance is written once and never overwritten on re-post.
 */

const mockGet = jest.fn();
const mockPut = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: {
    get: (...a: unknown[]) => mockGet(...a),
    put: (...a: unknown[]) => mockPut(...a),
  },
}));

import { recordPerformerConsent, PERFORMER_TERMS_VERSION } from '@/lib/performer-consent';

beforeEach(() => {
  mockGet.mockReset();
  mockPut.mockReset();
});

it('writes a new immutable consent record when none exists', async () => {
  mockGet.mockResolvedValueOnce(undefined);
  mockPut.mockResolvedValueOnce({});
  const now = () => new Date('2026-07-21T12:00:00.000Z');

  const { recorded, consent } = await recordPerformerConsent({ userId: 'sub-1', email: 'a@b.com', now });

  expect(recorded).toBe(true);
  expect(consent).toEqual({
    userId: 'sub-1',
    email: 'a@b.com',
    termsVersion: PERFORMER_TERMS_VERSION,
    acceptedAt: '2026-07-21T12:00:00.000Z',
  });
  const item = mockPut.mock.calls[0][0];
  expect(item.PK).toBe('CONSENT#sub-1');
  expect(item.SK).toBe(`TERMS#${PERFORMER_TERMS_VERSION}`);
  expect(item.entityType).toBe('CONSENT');
  expect(item.acceptedAt).toBe('2026-07-21T12:00:00.000Z');
  expect(item.source).toBe('performer-signup');
});

it('preserves the FIRST acceptance and does not overwrite on re-post', async () => {
  mockGet.mockResolvedValueOnce({ email: 'a@b.com', acceptedAt: '2026-01-01T00:00:00.000Z' });

  const { recorded, consent } = await recordPerformerConsent({ userId: 'sub-1', email: 'a@b.com' });

  expect(recorded).toBe(false);
  expect(consent.acceptedAt).toBe('2026-01-01T00:00:00.000Z'); // original moment kept
  expect(mockPut).not.toHaveBeenCalled();
});

it('omits email from the record when not provided', async () => {
  mockGet.mockResolvedValueOnce(undefined);
  mockPut.mockResolvedValueOnce({});
  await recordPerformerConsent({ userId: 'sub-2' });
  expect('email' in mockPut.mock.calls[0][0]).toBe(false);
});

it('rejects an empty userId before touching the store', async () => {
  await expect(recordPerformerConsent({ userId: '   ' })).rejects.toThrow(/userId/);
  expect(mockGet).not.toHaveBeenCalled();
});
