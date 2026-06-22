/**
 * POST /api/admin/prompt-critic { style, lyrics } — admin-gated LLM critique of a
 * style prompt + lyrics BEFORE a paid generation. Pairs with the free
 * deterministic linter (src/lib/prompt-preflight.ts): the linter catches
 * structural credit-wasters instantly; this catches semantic ones.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, authErrorResponse } from '@/lib/auth-helper';
import { critiquePrompt } from '@/services/ai/promptCritic';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({
  style: z.string().min(1).max(2000),
  lyrics: z.string().min(1).max(8000),
});

const STATUS: Record<string, number> = {
  not_configured: 503,
  auth: 502,
  rate_limit: 429,
  upstream: 502,
  bad_response: 502,
};

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return authErrorResponse(err);
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', errors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const result = await critiquePrompt(parsed.data, { signal: request.signal });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: STATUS[result.code] ?? 502 });
  }
  return NextResponse.json({ success: true, critique: result.critique });
}
