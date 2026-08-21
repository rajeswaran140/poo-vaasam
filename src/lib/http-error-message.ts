/**
 * Turn a bare HTTP status into something an admin can act on, not "HTTP 403".
 *
 * Extracted from /admin/analytics so the sibling panels
 * (ChannelRevenueByCountryPanel, and any future adminFetch-driven child) can
 * translate their own 401/403/5xx the same way — otherwise the page shows
 * "isn't an admin on this environment" for a 403 while a child panel in the
 * same tree shows "HTTP 403" for the same cause, and it reads as two
 * different bugs.
 */
export function httpErrorMessage(status: number): string {
  if (status === 401) return 'Your session expired — sign in again.';
  if (status === 403) return 'Your account isn’t an admin on this environment.';
  if (status >= 500) return 'The analytics service failed. Try again shortly.';
  return `Couldn’t load analytics (HTTP ${status}).`;
}
