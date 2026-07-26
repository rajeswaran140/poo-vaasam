/** @jest-environment node */
/**
 * DynamoDBOperations.scanAll — pages through LastEvaluatedKey so admin list
 * reads don't silently truncate at the ~1MB single-page limit. `scan` is spied.
 */
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

describe('DynamoDBOperations.scanAll', () => {
  afterEach(() => jest.restoreAllMocks());

  it('pages through LastEvaluatedKey until the scan is exhausted', async () => {
    const scan = jest
      .spyOn(DynamoDBOperations, 'scan')
      .mockResolvedValueOnce({ Items: [{ id: 1 }], LastEvaluatedKey: { PK: 'k1' } } as any)
      .mockResolvedValueOnce({ Items: [{ id: 2 }] } as any); // no cursor -> stop

    const res = await DynamoDBOperations.scanAll({ filterExpression: 'begins_with(PK, :p)' });

    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan.mock.calls[0][0]?.exclusiveStartKey).toBeUndefined(); // first page: no cursor
    expect(scan.mock.calls[1][0]?.exclusiveStartKey).toEqual({ PK: 'k1' }); // resumes from page 1
    expect(res.Items.map((i: any) => i.id)).toEqual([1, 2]);
    expect(res.truncated).toBe(false);
  });

  it('stops at the maxItems safety cap and reports truncated=true', async () => {
    // every page returns an item AND a cursor — would loop forever without the cap
    jest
      .spyOn(DynamoDBOperations, 'scan')
      .mockResolvedValue({ Items: [{ id: 'a' }], LastEvaluatedKey: { k: 'more' } } as any);

    const res = await DynamoDBOperations.scanAll({ maxItems: 3 });

    expect(res.Items).toHaveLength(3);
    expect(res.truncated).toBe(true);
  });

  it('tolerates a missing Items array', async () => {
    jest.spyOn(DynamoDBOperations, 'scan').mockResolvedValueOnce({} as any);
    const res = await DynamoDBOperations.scanAll();
    expect(res).toEqual({ Items: [], truncated: false });
  });
});
