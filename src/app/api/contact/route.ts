/**
 * Contact Form API
 *
 * POST /api/contact — public endpoint to submit a contact message.
 * Messages are stored in DynamoDB under PK=CONTACT#<id>, SK=METADATA.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DynamoDBOperations, handleDynamoDBError } from '@/infrastructure/database/dynamodb-client';
import { SharedRateLimiter, checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { sendContactNotification } from '@/lib/contact-notify';

export const dynamic = 'force-dynamic';

// Contact submissions are low-frequency for a real person; cap a single IP so a
// bot that gets past the honeypot can't flood DynamoDB with messages.
const limiter = new SharedRateLimiter({ bucket: 'contact', windowMs: 60_000, max: 5 });

const contactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).trim(),
  email: z.string().email('A valid email is required').max(200).trim(),
  subject: z.string().max(150).trim().optional(),
  message: z.string().min(1, 'Message is required').max(5000).trim(),
  // Honeypot: real users never fill this hidden field; bots often do.
  // Accept any value here so a filled value is silently discarded below
  // (rather than returning a validation error that reveals the trap).
  company: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const rl = await checkRateLimit(limiter, request);
    if (!rl.allowed) return rateLimitedResponse(rl);

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Honeypot tripped — pretend success, store nothing.
    if (parsed.data.company) {
      return NextResponse.json({ success: true, message: 'Message received' }, { status: 200 });
    }

    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();

    const subject = parsed.data.subject || '(No subject)';

    await DynamoDBOperations.put({
      PK: `CONTACT#${id}`,
      SK: 'METADATA',
      entityType: 'CONTACT_MESSAGE',
      id,
      name: parsed.data.name,
      email: parsed.data.email,
      subject,
      message: parsed.data.message,
      status: 'NEW',
      createdAt: now,
    });

    // Best-effort email alert. The message is already persisted, so a mail
    // failure (SES down, not configured, sandbox limits) must NOT fail the
    // request — swallow and log so the visitor still sees success.
    try {
      await sendContactNotification({
        name: parsed.data.name,
        email: parsed.data.email,
        subject,
        message: parsed.data.message,
      });
    } catch (mailError) {
      console.error('[API:CONTACT] notification email failed (message still saved):', mailError);
    }

    return NextResponse.json(
      { success: true, message: 'Your message has been sent. Thank you!' },
      { status: 201 }
    );
  } catch (error) {
    try {
      handleDynamoDBError(error);
    } catch {
      // fall through to generic response
    }
    console.error('[API:CONTACT] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send message. Please try again later.' },
      { status: 500 }
    );
  }
}
