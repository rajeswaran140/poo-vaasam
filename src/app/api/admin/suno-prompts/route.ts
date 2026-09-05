/**
 * GET  /api/admin/suno-prompts — list saved SUNO prompt packs, newest first.
 * POST /api/admin/suno-prompts — save a new one.
 *
 * Admin-gated, force-dynamic. Mutations additionally require a Bearer token as
 * defense-in-depth CSRF, matching the other admin mutation routes.
 *
 * Validation lives in sunoPromptInputSchema, including the rule that a prompt
 * not using an audio upload may not carry an audioInfluence value. That is
 * enforced here rather than trusted from the client: the UI hides the slider,
 * but a hidden control is not a constraint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireBearer, authErrorResponse } from '@/lib/auth-helper';
import { SunoPromptRepository } from '@/infrastructure/database/SunoPromptRepository';
import { sunoPromptInputSchema } from '@/types/sunoPrompt';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  try {
    const prompts = await new SunoPromptRepository().findAll();
    return NextResponse.json({ success: true, prompts });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to list prompts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    requireBearer(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  const parsed = sunoPromptInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Invalid prompt', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const prompt = await new SunoPromptRepository().create(parsed.data);
    return NextResponse.json({ success: true, prompt }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to save prompt' },
      { status: 500 }
    );
  }
}
