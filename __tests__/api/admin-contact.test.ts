/** @jest-environment node */
/**
 * GET /api/admin/contact — admin gate + FULL paginated read (no silent 1MB
 * truncation) + newest-first ordering. DynamoDB is mocked.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockScanAll = jest.fn();
jest.mock('@/infrastructure/database/dynamodb-client', () => ({
  DynamoDBOperations: { scanAll: (...a: unknown[]) => mockScanAll(...a) },
}));

import { GET } from '@/app/api/admin/contact/route';
import * as auth from '@/lib/auth-helper';

const requireAdmin = auth.requireAdmin as jest.Mock;
const req = () => new NextRequest('http://localhost/api/admin/contact');

const ITEMS = [
  { PK: 'CONTACT#1', SK: 'METADATA', name: 'Old', createdAt: '2026-06-01T10:00:00Z' },
  { PK: 'CONTACT#2', SK: 'METADATA', name: 'New', createdAt: '2026-06-20T10:00:00Z' },
];

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ userId: 'admin' });
  mockScanAll.mockReset().mockResolvedValue({ Items: ITEMS, truncated: false });
});

it('401s when not an admin and never touches the DB', async () => {
  requireAdmin.mockRejectedValueOnce(new auth.AuthError('Unauthorized', 401));
  const res = await GET(req());
  expect(res.status).toBe(401);
  expect(mockScanAll).not.toHaveBeenCalled();
});

it('lists messages newest-first via the paginated helper', async () => {
  const res = await GET(req());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(mockScanAll).toHaveBeenCalledTimes(1); // scanAll, not a single-page scan
  expect(json.total).toBe(2);
  expect(json.data.map((m: { name: string }) => m.name)).toEqual(['New', 'Old']);
  expect(json.truncated).toBe(false);
});

it('surfaces truncated=true when the safety cap is hit', async () => {
  mockScanAll.mockResolvedValueOnce({ Items: ITEMS, truncated: true });
  const json = await (await GET(req())).json();
  expect(json.truncated).toBe(true);
});

it('returns 500 generically when the read throws', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockScanAll.mockRejectedValueOnce(new Error('ddb boom'));
  const res = await GET(req());
  expect(res.status).toBe(500);
  expect((await res.json()).error).not.toMatch(/ddb boom/);
});
