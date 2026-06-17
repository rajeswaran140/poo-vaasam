/**
 * setPerformerAssets — persist (or clear) a song's gated performer assets
 * (lyrics, backing-track S3 key, backing-track duration) on its Content
 * METADATA item. A single atomic DynamoDB UPDATE that touches only these
 * fields — mirrors setSongTheme so per-field admin writes stay consistent.
 *
 * For each field: a non-empty value SETs it; an empty string / null / 0 REMOVEs
 * it (clears the asset). `undefined` leaves the field untouched. Throws
 * `ConditionalCheckFailedException` when the song row is missing (→ 404).
 */

import { DynamoDBClient, UpdateItemCommand, type AttributeValue } from '@aws-sdk/client-dynamodb';
import { awsConfig, dynamoDBConfig } from '@/lib/aws-config';

const db = new DynamoDBClient(awsConfig);

export interface PerformerAssetsInput {
  lyrics?: string;
  instrumentalKey?: string;
  instrumentalDuration?: number | null;
}

export async function setPerformerAssets(id: string, input: PerformerAssetsInput): Promise<void> {
  const setParts: string[] = ['updatedAt = :now'];
  const removeParts: string[] = [];
  const values: Record<string, AttributeValue> = { ':now': { S: new Date().toISOString() } };

  if (input.lyrics !== undefined) {
    if (input.lyrics.trim()) {
      setParts.push('lyrics = :lyrics');
      values[':lyrics'] = { S: input.lyrics };
    } else {
      removeParts.push('lyrics');
    }
  }
  if (input.instrumentalKey !== undefined) {
    if (input.instrumentalKey.trim()) {
      setParts.push('instrumentalKey = :ik');
      values[':ik'] = { S: input.instrumentalKey };
    } else {
      removeParts.push('instrumentalKey');
    }
  }
  if (input.instrumentalDuration !== undefined) {
    if (typeof input.instrumentalDuration === 'number' && input.instrumentalDuration > 0) {
      setParts.push('instrumentalDuration = :idur');
      values[':idur'] = { N: String(Math.round(input.instrumentalDuration)) };
    } else {
      removeParts.push('instrumentalDuration');
    }
  }

  const expression = [
    setParts.length ? `SET ${setParts.join(', ')}` : '',
    removeParts.length ? `REMOVE ${removeParts.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  await db.send(
    new UpdateItemCommand({
      TableName: dynamoDBConfig.tableName,
      Key: { PK: { S: `CONTENT#${id}` }, SK: { S: 'METADATA' } },
      UpdateExpression: expression,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(PK)',
    })
  );
}
