/** @jest-environment node */
/**
 * GET /api/ragas — the public Carnatic & Hindustani raga catalog.
 */

import { NextRequest } from 'next/server';
import { GET, dynamic } from '@/app/api/ragas/route';

const call = (qs = '') => GET(new NextRequest(`http://localhost:3000/api/ragas${qs}`));

it('is a dynamic route so query-param filters actually run (not force-static)', () => {
  expect(dynamic).toBe('force-dynamic');
});

it('returns the full catalog with a cache header', async () => {
  const res = call();
  expect(res.headers.get('Cache-Control')).toMatch(/max-age=3600/);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.total).toBe(body.data.length);
  expect(body.data.length).toBeGreaterThanOrEqual(20);
});

it('filters by tradition=Carnatic', async () => {
  const body = await call('?tradition=Carnatic').json();
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.data.every((r: { tradition: string }) => r.tradition === 'Carnatic')).toBe(true);
});

it('filters by mood=devotional', async () => {
  const body = await call('?mood=devotional').json();
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.data.every((r: { moods: string[] }) => r.moods.includes('devotional'))).toBe(true);
});
