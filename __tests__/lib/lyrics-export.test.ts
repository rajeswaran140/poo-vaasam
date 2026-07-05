/** @jest-environment node */
import {
  formatLyricsForClipboard,
  escapeHtml,
  buildPrintableLyricsHtml,
} from '@/lib/lyrics-export';

describe('formatLyricsForClipboard', () => {
  it('includes title, lyrics, and the attribution footer', () => {
    const out = formatLyricsForClipboard('எங்கள் தேசம்', '  வரி ஒன்று\nவரி இரண்டு  ');
    expect(out).toContain('எங்கள் தேசம்');
    expect(out).toContain('வரி ஒன்று');
    expect(out).toContain('© Rajeswaran Thangarajah');
    expect(out).toContain('For singing only');
    expect(out).toContain('https://tamilagaval.com/terms');
    // body is trimmed: it starts right after the title's blank line (no leading
    // spaces) and the trailing spaces are gone before the footer.
    expect(out).toContain('\n\nவரி ஒன்று');
    expect(out).toContain('வரி இரண்டு\n\n—');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });
});

describe('buildPrintableLyricsHtml', () => {
  it('produces a full document with escaped title/body, attribution, and auto-print', () => {
    const html = buildPrintableLyricsHtml('T<i>', 'lyric <b> line');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('lang="ta"');
    expect(html).toContain('T&lt;i&gt;'); // title escaped
    expect(html).toContain('lyric &lt;b&gt; line'); // body escaped
    expect(html).not.toContain('<b> line'); // no raw injection
    expect(html).toContain('© Rajeswaran Thangarajah');
    expect(html).toContain('window.print()');
    expect(html).toContain('Noto Sans Tamil');
  });
});
