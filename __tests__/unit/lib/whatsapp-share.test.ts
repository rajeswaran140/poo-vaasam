import { whatsappShareText, whatsappShareUrl } from '@/lib/whatsapp-share';

describe('whatsappShareText', () => {
  it('builds a song message: 🎵 + title + Tamil "listen" CTA + utm-tagged url', () => {
    expect(whatsappShareText({ title: 'எங்கள் தேசம்', url: 'https://tamilagaval.com/thayagam' })).toBe(
      '🎵 எங்கள் தேசம் — கேளுங்கள்: https://tamilagaval.com/thayagam?utm_source=whatsapp&utm_medium=share'
    );
  });

  it('uses the "read" CTA + 📜 for text content (also utm-tagged)', () => {
    expect(whatsappShareText({ title: 'அம்மா', url: 'https://tamilagaval.com/content/cnt_x', verb: 'read' })).toBe(
      '📜 அம்மா — படியுங்கள்: https://tamilagaval.com/content/cnt_x?utm_source=whatsapp&utm_medium=share'
    );
  });

  it('tags the shared link with utm_source=whatsapp so inbound is attributable', () => {
    const text = whatsappShareText({ title: 'T', url: 'https://tamilagaval.com/x' });
    expect(text).toContain('utm_source=whatsapp');
    expect(text).toContain('utm_medium=share');
  });

  it('defaults to "listen" when no verb is given', () => {
    expect(whatsappShareText({ title: 'T', url: 'u' })).toContain('கேளுங்கள்');
  });

  it('merges override UTM tags (Status share: medium + campaign + source-song content)', () => {
    const text = whatsappShareText({
      title: 'T',
      url: 'https://tamilagaval.com/content/cnt_9',
      utm: { utm_medium: 'whatsapp_status', utm_campaign: 'status_share', utm_content: 'cnt_9' },
    });
    expect(text).toContain('utm_source=whatsapp'); // default kept
    expect(text).toContain('utm_medium=whatsapp_status'); // overridden (not "share")
    expect(text).not.toContain('utm_medium=share');
    expect(text).toContain('utm_campaign=status_share');
    expect(text).toContain('utm_content=cnt_9'); // source song id → inbound attribution
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
