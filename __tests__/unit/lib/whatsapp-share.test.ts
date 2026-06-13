import { whatsappShareText, whatsappShareUrl } from '@/lib/whatsapp-share';

describe('whatsappShareText', () => {
  it('builds a song message: 🎵 + title + Tamil "listen" CTA + url', () => {
    expect(whatsappShareText({ title: 'எங்கள் தேசம்', url: 'https://tamilagaval.com/thayagam' })).toBe(
      '🎵 எங்கள் தேசம் — கேளுங்கள்: https://tamilagaval.com/thayagam'
    );
  });

  it('uses the "read" CTA + 📜 for text content', () => {
    expect(whatsappShareText({ title: 'அம்மா', url: 'https://tamilagaval.com/content/cnt_x', verb: 'read' })).toBe(
      '📜 அம்மா — படியுங்கள்: https://tamilagaval.com/content/cnt_x'
    );
  });

  it('defaults to "listen" when no verb is given', () => {
    expect(whatsappShareText({ title: 'T', url: 'u' })).toContain('கேளுங்கள்');
  });
});

describe('whatsappShareUrl', () => {
  it('points at wa.me with the URL-encoded message', () => {
    const url = whatsappShareUrl({ title: 'எங்கள் தேசம்', url: 'https://tamilagaval.com/thayagam' });
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const text = decodeURIComponent(url.slice('https://wa.me/?text='.length));
    expect(text).toBe(whatsappShareText({ title: 'எங்கள் தேசம்', url: 'https://tamilagaval.com/thayagam' }));
  });

  it('percent-encodes spaces and the leading emoji (no raw spaces leak)', () => {
    const url = whatsappShareUrl({ title: 'two words', url: 'https://x.test/a' });
    expect(url).not.toMatch(/\stwo\s/);
    expect(url).toContain('%20'); // spaces encoded
  });
});
