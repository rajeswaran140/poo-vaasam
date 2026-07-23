/** @jest-environment node */
/**
 * attachmentDisposition — the Content-Disposition value that lets a Tamil master
 * title survive the download. If the encoding is wrong the file either saves
 * with a mangled name or the header breaks, so it is worth pinning.
 */

import { attachmentDisposition } from '@/lib/content-disposition';

describe('attachmentDisposition', () => {
  it('emits both an ASCII filename and a UTF-8 filename* (RFC 6266)', () => {
    const v = attachmentDisposition('Amma En Agame (Master -14 LUFS).wav');
    expect(v.startsWith('attachment; ')).toBe(true);
    expect(v).toContain('filename="Amma En Agame (Master -14 LUFS).wav"');
    expect(v).toContain("filename*=UTF-8''");
  });

  it('percent-encodes Tamil in filename* and keeps a safe ASCII fallback', () => {
    const v = attachmentDisposition('அம்மம்மா.wav');
    // filename* carries the real (encoded) name...
    expect(v).toContain("filename*=UTF-8''" + encodeURIComponent('அம்மம்மா.wav'));
    // ...while the ASCII fallback has no raw non-ASCII bytes.
    const ascii = v.match(/filename="([^"]*)"/)![1];
    expect(ascii).toMatch(/^[\x20-\x7e]*$/);
  });

  it('cannot inject extra header directives via quotes or newlines', () => {
    const v = attachmentDisposition('evil".wav\r\nSet-Cookie: x=1');
    const ascii = v.match(/filename="([^"]*)"/)![1];
    expect(ascii).not.toContain('"');
    expect(v).not.toMatch(/[\r\n]/);
  });

  it('never produces an empty quoted filename', () => {
    expect(attachmentDisposition('அ')).toContain('filename="download"');
  });
});
