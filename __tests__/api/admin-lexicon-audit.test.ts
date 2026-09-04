/** @jest-environment node */
/**
 * GET /api/admin/lexicon/audit — admin gate, and the payload contract that
 * matters: every code the report counts must actually be reachable.
 *
 * The bug this pins down: the route sorted findings by severity and sliced the
 * first 500. On the live lexicon that budget was consumed entirely by
 * high-severity `suspicious-sangam`, so `missing-themes`, `missing-tamil-meaning`
 * and `near-duplicate` never left the server. AuditPanel builds its filter chips
 * from the UNCAPPED `countsByCode` and filters the returned `findings` client
 * side, so those chips showed a four-figure count and then rendered nothing.
 */

import { NextRequest } from 'next/server';

jest.mock('@/lib/auth-helper', () => ({
  ...jest.requireActual('@/lib/auth-helper'),
  requireAdmin: jest.fn(),
}));

const mockFindAll = jest.fn();
jest.mock('@/infrastructure/database/LexiconRepository', () => ({
  LexiconRepository: jest.fn().mockImplementation(() => ({ findAll: mockFindAll })),
}));

import { GET } from '@/app/api/admin/lexicon/audit/route';
import * as auth from '@/lib/auth-helper';
import type { LexiconWord } from '@/types/lexicon';

const requireAdmin = auth.requireAdmin as jest.Mock;
const get = () => GET(new NextRequest('https://tamilagaval.com/api/admin/lexicon/audit'));

/** An entry shaped like the live lexicon: defaulted sangam, no themes, no Tamil meaning. */
const unreviewed = (i: number): LexiconWord =>
  ({
    id: `lex_${i}`,
    word: `சொல்${i}`,
    normalizedWord: `சொல்${i}`,
    gloss: 'a meaning',
    register: 'sangam',
    registers: ['sangam'],
    usage: 'fresh',
    themes: [],
    moods: [],
    synonyms: [],
    relatedWords: [],
    antonyms: [],
    etukai: [],
    monai: [],
    rhymesWith: [],
    semanticFamily: [],
    examples: [],
    usageCount: 0,
    archived: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  }) as unknown as LexiconWord;

beforeEach(() => {
  jest.clearAllMocks();
  requireAdmin.mockResolvedValue({ email: 'raj@example.com' });
});

describe('admin gate', () => {
  it('rejects a caller who is not an admin', async () => {
    requireAdmin.mockRejectedValue(new Error('Unauthorized'));
    const res = await get();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockFindAll).not.toHaveBeenCalled();
  });
});

describe('the capped payload keeps every counted code reachable', () => {
  // 600 entries -> ~1,800 findings, far past the 500 cap, dominated by the
  // high-severity sangam code exactly as the live data is.
  const many = Array.from({ length: 600 }, (_, i) => unreviewed(i));

  it('returns at least one finding for every code in countsByCode', async () => {
    mockFindAll.mockResolvedValue(many);
    const body = await (await get()).json();

    expect(body.success).toBe(true);
    expect(body.truncated).toBe(true);

    const counted = Object.keys(body.countsByCode).sort();
    const returned = [...new Set((body.findings as { code: string }[]).map((f) => f.code))].sort();
    expect(returned).toEqual(counted);
  });

  it('still respects the cap', async () => {
    mockFindAll.mockResolvedValue(many);
    const body = await (await get()).json();
    expect(body.findings.length).toBeLessThanOrEqual(500);
    expect(body.totalFindings).toBeGreaterThan(500);
  });

  it('reports the true total, not the capped length', async () => {
    mockFindAll.mockResolvedValue(many);
    const body = await (await get()).json();
    expect(body.total).toBe(600);
    expect(body.totalFindings).toBeGreaterThan(body.findings.length);
  });

  it('does not mark a small lexicon as truncated', async () => {
    mockFindAll.mockResolvedValue([unreviewed(1)]);
    const body = await (await get()).json();
    expect(body.truncated).toBe(false);
    expect(body.findings.length).toBe(body.totalFindings);
  });
});
