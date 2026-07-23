/**
 * Build a `Content-Disposition: attachment` header value that survives
 * non-ASCII filenames (Tamil, accents). Pure — no I/O.
 *
 * Per RFC 6266/5987 a robust header carries BOTH forms: an ASCII `filename=`
 * that legacy clients understand, and a UTF-8 `filename*=` that every modern
 * browser prefers. Without the second, a name like `அம்மம்மா என் அகமே.wav`
 * would arrive mangled or fall back to the raw S3 key. Both values are
 * sanitised so a crafted name can't inject extra header directives.
 */
export function attachmentDisposition(filename: string): string {
  // ASCII fallback: drop anything outside printable ASCII (filename* carries the
  // real name for modern clients) plus the characters that would terminate or
  // confuse the quoted-string ("\), then collapse the gaps. Empty ⇒ "download".
  const ascii =
    filename
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'download';

  // RFC 5987 ext-value: percent-encode UTF-8, then also encode the few
  // characters encodeURIComponent leaves that are not valid in an ext-value.
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );

  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
