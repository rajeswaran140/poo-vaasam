/**
 * Application-layer error types.
 *
 * These let API routes distinguish *expected* domain failures (safe to show the
 * caller, mapped to 4xx) from *unexpected* infrastructure failures (logged
 * server-side, returned as a generic 5xx so DynamoDB/internal detail never
 * leaks to the client).
 */

/** A business-rule violation the caller can act on (e.g. "Categories not found"). Maps to HTTP 400. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/**
 * The transactional content create lost the slug-uniqueness race (the hard
 * `attribute_not_exists` guard on the SLUG# item fired). The use case catches
 * this and retries with a bumped slug.
 */
export class SlugConflictError extends Error {
  constructor(public readonly slug: string) {
    super(`Slug already exists: ${slug}`);
    this.name = 'SlugConflictError';
  }
}
