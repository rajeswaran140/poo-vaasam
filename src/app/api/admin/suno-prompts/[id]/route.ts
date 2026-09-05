/**
 * GET/PUT/DELETE /api/admin/suno-prompts/[id] — read, edit and remove one saved
 * SUNO prompt pack.
 *
 * Admin-gated; the two mutations also require a Bearer token as defense-in-depth
 * CSRF. An empty PUT is rejected rather than treated as a no-op write, so a UI
 * bug that sends nothing cannot quietly bump updatedAt on every prompt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { SunoPromptRepository } from '@/infrastructure/database/SunoPromptRepository';
import { sunoPromptUpdateSchema } from '@/types/sunoPrompt';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  try {
    const prompt = await new SunoPromptRepository().findById(id);
    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to read prompt' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = sunoPromptUpdateSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { success: false, error: 'Invalid update', issues: parsed.success ? [] : parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const prompt = await new SunoPromptRepository().update(id, parsed.data);
    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Prompt not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true, prompt });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update prompt' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const { id } = await params;
  try {
    const removed = await new SunoPromptRepository().delete(id);
    if (!removed) {
      return NextResponse.json({ success: false, error: 'Prompt not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to delete prompt' },
      { status: 500 }
    );
  }
}
