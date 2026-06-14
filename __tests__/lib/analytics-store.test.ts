/** @jest-environment node */
/**
 * First-party event store: the pure summariser plus the DynamoDB read/write
 * (atomic ADD counter + SK-range query), with DynamoDBOperations mocked.
 */

jest.mock('@/infrastructure/database/dynamodb-client', () => {
  const update = jest.fn();
  const query = jest.fn();
  return { DynamoDBOperations: { update, query }, __update: update, __query: query };
});

import { recordEvent, summariseEvents, fetchEventSummary, type EventRow } from '@/lib/analytics-store';

const dbMock = jest.requireMock('@/infrastructure/database/dynamodb-client') as Record<string, jest.Mock>;
const update = dbMock.__update;
const query = dbMock.__query;

beforeEach(() => { update.mockReset(); query.mockReset(); });

describe('summariseEvents', () => {
  const rows: EventRow[] = [
    { type: 'share', target: 'whatsapp', count: 5, date: '2026-06-13' },
    { type: 'share', target: 'whatsapp', count: 3, date: '2026-06-14' }, // same target, diff day → merge
    { type: 'share', target: 'facebook', count: 2, date: '2026-06-14' },
    { type: 'play', target: 'song:a', count: 12, date: '2026-06-14' },
  ];

  it('totals per type and ranks the grand total', () => {
    const s = summariseEvents(rows);
    expect(s.total).toBe(22);
    expect(s.totals).toEqual([
      { type: 'play', count: 12 },
      { type: 'share', count: 10 },
    ]);
  });

  it('merges a target across days and ranks top targets per type', () => {
    const s = summariseEvents(rows);
    expect(s.byType.share).toEqual([
      { target: 'whatsapp', count: 8 },
      { target: 'facebook', count: 2 },
    ]);
  });

  it('caps top targets at topN', () => {
    const many: EventRow[] = Array.from({ length: 5 }, (_, i) => ({
      type: 'play', target: `song:${i}`, count: i + 1, date: '2026-06-14',
    }));
    const s = summariseEvents(many, 2);
    expect(s.byType.play).toHaveLength(2);
    expect(s.byType.play[0]).toEqual({ target: 'song:4', count: 5 });
  });

  it('ignores rows with no type and bad counts', () => {
    const s = summariseEvents([{ type: '', target: 'x', count: 9, date: 'd' }] as EventRow[]);
    expect(s.total).toBe(0);
    expect(s.totals).toEqual([]);
  });
});

describe('recordEvent', () => {
  it('atomically ADDs to the day/type/target counter with a sanitized key', async () => {
    update.mockResolvedValueOnce({});
    await recordEvent('share', 'whats#app', '2026-06-14');
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.key).toEqual({ PK: 'EVENT', SK: '2026-06-14#share#whats_app' });
    expect(arg.updateExpression).toContain('ADD #count :inc');
    expect(arg.expressionAttributeValues[':inc']).toBe(1);
    expect(arg.expressionAttributeValues[':target']).toBe('whats_app');
  });
});

describe('fetchEventSummary', () => {
  it('queries the SK date range and summarises, following pagination', async () => {
    query
      .mockResolvedValueOnce({
        Items: [{ eventType: 'share', eventTarget: 'whatsapp', count: 4, eventDate: '2026-06-14' }],
        LastEvaluatedKey: { PK: 'EVENT', SK: 'x' },
      })
      .mockResolvedValueOnce({
        Items: [{ eventType: 'share', eventTarget: 'whatsapp', count: 1, eventDate: '2026-06-14' }],
      });
    const s = await fetchEventSummary(7);
    expect(query).toHaveBeenCalledTimes(2);
    const params = query.mock.calls[0][0];
    expect(params.keyConditionExpression).toContain('SK BETWEEN');
    expect(params.expressionAttributeValues[':pk']).toBe('EVENT');
    expect(s.total).toBe(5);
    expect(s.byType.share).toEqual([{ target: 'whatsapp', count: 5 }]);
  });
});
