/**
 * PATCH /api/admin/content/[id]/workflow
 *
 * Persist a content row's production-pipeline state (Phase 1 Studio).
 * Single-purpose endpoint: only touches the `workflowState` field, so the
 * kanban can move cards without us serialising the whole record back.
 *
 * Body: { state: WorkflowState | '' }   '' clears the state.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { WORKFLOW_STATES } from '@/types/content';
import { awsConfig, dynamoDBConfig } from '@/lib/aws-config';

const schema = z.object({
  state: z.union([
    z.enum(WORKFLOW_STATES as unknown as [string, ...string[]]),
    z.literal(''),
  ]),
});

const db = new DynamoDBClient(awsConfig);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  if (!id || !/^cnt_[a-z0-9_]+$/i.test(id)) {
    return NextResponse.json({ success: false, error: 'Bad content id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid workflow state' },
      { status: 400 }
    );
  }
  const { state } = parsed.data;

  try {
    await db.send(
      new UpdateItemCommand({
        TableName: dynamoDBConfig.tableName,
        Key: { PK: { S: `CONTENT#${id}` }, SK: { S: 'METADATA' } },
        ...(state === ''
          ? { UpdateExpression: 'REMOVE workflowState' }
          : {
              UpdateExpression: 'SET workflowState = :s',
              ExpressionAttributeValues: { ':s': { S: state } },
            }),
        ConditionExpression: 'attribute_exists(PK)',
      })
    );
    return NextResponse.json({ success: true, id, state });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ success: false, error: 'Content not found' }, { status: 404 });
    }
    console.error('[admin/content/workflow] update failed:', err);
    return NextResponse.json({ success: false, error: 'DB write failed' }, { status: 500 });
  }
}
