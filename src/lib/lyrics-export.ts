/**
 * Lyrics export helpers — format the gated lyrics for clipboard copy and for a
 * print-to-PDF view. Every export carries the author's attribution + the
 * "for singing only" terms, so a saved/copied copy stays attributed.
 *
 * PDF is produced via the browser's print dialog (Save as PDF): the browser
 * renders Tamil script correctly, whereas client PDF libs (jsPDF) would need a
 * heavy embedded Tamil font. buildPrintableLyricsHtml() returns a self-contained
 * document opened in a new window that auto-invokes print().
 */

const AUTHOR = 'Raj Thangarajah';
const SITE = 'tamilagaval.com';
const TERMS_URL = 'https://tamilagaval.com/terms';

/** Plain-text block for the clipboard: title, lyrics, then an attribution footer. */
export function formatLyricsForClipboard(title: string, body: string): string {
  return (
    `${title}\n\n` +
    `${body.trim()}\n\n` +
    `— © ${AUTHOR} · ${SITE}\n` +
    `பாடுவதற்கு மட்டுமே / For singing only · ${TERMS_URL}`
  );
}

/** Minimal HTML-escape for safe interpolation into the printable document. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A self-contained printable HTML document for the lyrics. Opened in a new
 * window; auto-focuses and calls print() so the user can "Save as PDF". Tamil
 * renders via the browser's own font stack.
 */
export function buildPrintableLyricsHtml(title: string, body: string): string {
  const t = escapeHtml(title);
  const b = escapeHtml(body.trim());
  return `<!doctype html>
<html lang="ta">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t} — பாடல் வரிகள்</title>
<style>
  @page { margin: 20mm; }
  html, body { margin: 0; }
  body { font-family: 'Noto Sans Tamil', 'Latha', 'Baloo Thambi 2', system-ui, sans-serif; color: #1a1a1a; padding: 24px; }
  h1 { font-size: 20pt; text-align: center; margin: 0 0 4pt; }
  .sub { text-align: center; color: #666; font-size: 10pt; margin: 0 0 18pt; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 13pt; line-height: 2.1; margin: 0; }
  footer { margin-top: 24pt; border-top: 1px solid #ccc; padding-top: 8pt; font-size: 9pt; color: #666; text-align: center; }
</style>
</head>
<body>
  <h1>${t}</h1>
  <p class="sub">தமிழகவல் · ${SITE}</p>
  <pre>${b}</pre>
  <footer>© ${AUTHOR} · பாடுவதற்கு மட்டுமே / For singing only · ${TERMS_URL}</footer>
  <script>window.onload = function () { try { window.focus(); window.print(); } catch (e) {} };</script>
</body>
</html>`;
}
