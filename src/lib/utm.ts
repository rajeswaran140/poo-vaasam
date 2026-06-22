/**
 * Append UTM (or any) query params to a URL without clobbering existing ones.
 *
 * Used to tag share links — e.g. a WhatsApp share gets `?utm_source=whatsapp`
 * so the inbound visit is attributable (GA4 reads UTMs natively; we also catch
 * it first-party via InboundTracker). Pure + idempotent: existing keys are left
 * as-is, so re-tagging a URL never duplicates params.
 */

export function appendUtm(url: string, params: Record<string, string>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return url;

  try {
    // Absolute URL — the reliable path (share URLs are always absolute).
    const u = new URL(url);
    for (const [k, v] of entries) if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    // Relative/invalid — fall back to a manual, dedupe-aware append.
    const existing = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const have = new Set(existing.split('&').map((p) => p.split('=')[0]));
    const add = entries
      .filter(([k]) => !have.has(k))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    if (add.length === 0) return url;
    return `${url}${url.includes('?') ? '&' : '?'}${add.join('&')}`;
  }
}
