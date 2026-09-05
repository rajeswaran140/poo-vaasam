/**
 * Single-tenant marker for the Twitch integration Phase 1.
 *
 * Every Twitch DynamoDB key is prefixed `TENANT#<tenantId>#TWITCH#…` and every
 * SSM SecureString param is suffixed `_<tenantId>` so that future multi-tenant
 * work becomes a query-scope change, not a schema migration.
 *
 * Today the only creator is TamilAgaval; `currentTenantId()` returns it as a
 * constant. When multi-tenant lands, this function becomes the ONE place that
 * resolves tenant from an authenticated request context — every caller reads
 * through it, so the callers don't change.
 */

export const TAMILAGAVAL_TENANT_ID = 'tamilagaval';

/**
 * Resolve the current tenant. Constant in Phase 1; a function so the shape
 * survives the multi-tenant transition unchanged.
 */
export function currentTenantId(): string {
  return TAMILAGAVAL_TENANT_ID;
}
