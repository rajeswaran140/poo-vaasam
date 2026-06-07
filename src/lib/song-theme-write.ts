/**
 * setSongTheme — persist (or clear) a song's per-row theme override on its
 * Content METADATA item. Shared by PATCH /api/admin/songs/[id]/theme and the
 * one-call publish flow so the write lives in exactly one place.
 *
 * `theme === ''` clears the override (song falls back to the SONG_THEME_BY_ID
 * config map). Throws `ConditionalCheckFailedException` if the song row is
 * missing (callers map that to 404).
 */

import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { awsConfig, dynamoDBConfig } from '@/lib/aws-config';

const db = new DynamoDBClient(awsConfig);

export async function setSongTheme(id: string, theme: string): Promise<void> {
  await db.send(
    new UpdateItemCommand({
      TableName: dynamoDBConfig.tableName,
      Key: { PK: { S: `CONTENT#${id}` }, SK: { S: 'METADATA' } },
      ...(theme === ''
        ? { UpdateExpression: 'REMOVE theme' }
        : {
            UpdateExpression: 'SET theme = :t',
            ExpressionAttributeValues: { ':t': { S: theme } },
          }),
      ConditionExpression: 'attribute_exists(PK)',
    })
  );
}
