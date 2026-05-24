/**
 * SEO helpers — canonical base URL and small text utilities.
 */

export const SITE_URL = 'https://tamilagaval.com';
export const SITE_NAME = 'தமிழகவல்';

/** Build an absolute URL from a path. */
export function absoluteUrl(path = ''): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Collapse whitespace and truncate text for use as a meta description. */
export function toDescription(text: string, max = 160): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
