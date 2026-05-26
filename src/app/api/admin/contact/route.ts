/**
 * Admin Contact Messages API
 *
 * GET /api/admin/contact — list contact-form submissions (auth required).
 */

import { NextRequest, NextResponse } from 'next/server';
import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    try {
      await requireAdmin(request);
    } catch (authError) {
      return authErrorResponse(authError);
    }

    // Low-volume admin read: scan + filter on the CONTACT# key namespace.
    const response = await DynamoDBOperations.scan({
      filterExpression: 'begins_with(PK, :p) AND SK = :sk',
      expressionAttributeValues: { ':p': 'CONTACT#', ':sk': 'METADATA' },
    });

    const items = (response.Items || []).sort(
      (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
    );

    return NextResponse.json({ success: true, data: items, total: items.length });
  } catch (error) {
    console.error('[API:ADMIN_CONTACT] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}
