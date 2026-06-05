/** @jest-environment node */
/**
 * GET /api/instruments — the public India & Sri Lanka instrument catalog.
 */

import { NextRequest } from 'next/server';
import { GET, dynamic } from '@/app/api/instruments/route';

const call = (qs = '') => GET(new NextRequest(`http://localhost:3000/api/instruments${qs}`));

it('is a dynamic route so query-param filters actually run (not force-static)', () => {
  // force-static would prerender one empty-param response and ignore filters.
  expect(dynamic).toBe('force-dynamic');
});

it('returns the full catalog with a cache header', async () => {
  const res = call();
  expect(res.headers.get('Cache-Control')).toMatch(/max-age=3600/);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.total).toBe(body.data.length);
  expect(body.data.length).toBeGreaterThanOrEqual(25);
});

it('filters by region=Sri Lanka', async () => {
  const body = await call('?region=Sri Lanka').json();
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.data.every((i: { region: string }) => i.region === 'Sri Lanka' || i.region === 'Both')).toBe(true);
});

it('filters by category=percussion', async () => {
  const body = await call('?category=percussion').json();
  expect(body.data.every((i: { category: string }) => i.category === 'percussion')).toBe(true);
});

it('supports free-text search', async () => {
  const body = await call('?q=veena').json();
  expect(body.data.some((i: { name: string }) => i.name === 'Veena')).toBe(true);
});
