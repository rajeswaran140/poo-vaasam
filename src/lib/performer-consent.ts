/**
 * Performer consent — a durable, auditable record that a performer accepted the
 * performance terms at signup.
 *
 * The signup checkbox (PerformerGate) is a *client* gate — it blocks signup in
 * the browser but leaves no server-side proof. PIPEDA needs demonstrable consent,
 * so we persist an immutable record keyed by the Cognito identity: the FIRST
 * acceptance of a given terms version is preserved (re-posting never rewrites the
 * original timestamp). Stored in the app's DynamoDB table (ca-central-1), where
 * the rest of the subscriber/personal data already lives.
 *
 * Record shape:  PK = CONSENT#<userId>, SK = TERMS#<termsVersion>
 *   { entityType:'CONSENT', userId, email?, termsVersion, acceptedAt, source }
 *
 * Retention: kept for the life of the account as the consent audit trail; removed
 * as part of a data-subject deletion request (see the deletion runbook — blocker
 * 3b). NOT exposed on any public contract.
 */

import { DynamoDBOperations } from '@/infrastructure/database/dynamodb-client';

/**
 * Current performance-terms version. Bump when the terms text changes so a new
 * acceptance is recorded against the new version (old records stay as the audit
 * trail of what each user actually agreed to).
 */
export const PERFORMER_TERMS_VERSION = '2026-07-21';

export interface PerformerConsentRecord {
  userId: string;
  email?: string;
  termsVersion: string;
  acceptedAt: string;
}

function consentKey(userId: string, termsVersion: string) {
  return { PK: `CONSENT#${userId}`, SK: `TERMS#${termsVersion}` };
}

/**
 * Record acceptance of the current terms for `userId` — idempotent and
 * immutable: if a record for this (user, termsVersion) already exists, its
 * original `acceptedAt` is returned unchanged (`recorded:false`); otherwise a new
 * record is written (`recorded:true`). `now` is injected for deterministic tests.
 */
export async function recordPerformerConsent(input: {
  userId: string;
  email?: string;
  now?: () => Date;
}): Promise<{ recorded: boolean; consent: PerformerConsentRecord }> {
  const userId = input.userId?.trim();
  if (!userId) throw new Error('recordPerformerConsent requires a userId');

  const key = consentKey(userId, PERFORMER_TERMS_VERSION);
  const existing = await DynamoDBOperations.get(key);
  if (existing) {
    // Preserve the first acceptance — never overwrite the original moment.
    return {
      recorded: false,
      consent: {
        userId,
        email: typeof existing.email === 'string' ? existing.email : undefined,
        termsVersion: PERFORMER_TERMS_VERSION,
        acceptedAt: String(existing.acceptedAt),
      },
    };
  }

  const acceptedAt = (input.now ?? (() => new Date()))().toISOString();
  await DynamoDBOperations.put({
    ...key,
    entityType: 'CONSENT',
    userId,
    ...(input.email ? { email: input.email } : {}),
    termsVersion: PERFORMER_TERMS_VERSION,
    acceptedAt,
    source: 'performer-signup',
  });
  return { recorded: true, consent: { userId, email: input.email, termsVersion: PERFORMER_TERMS_VERSION, acceptedAt } };
}
