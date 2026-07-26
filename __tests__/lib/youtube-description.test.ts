import {
  assembleYoutubeDescription,
  buildDescriptionFooter,
  pickThemePlaylist,
  stripScaffoldingLabels,
  splitTrailingHashtags,
  stripForbiddenCreditLines,
  buildDescriptionLead,
  CREDIT_BLOCK,
} from '@/lib/youtube-description';

describe('stripScaffoldingLabels', () => {
  it('drops a leaked "YouTube Description" leading label + trailing blanks', () => {
    const out = stripScaffoldingLabels('YouTube Description\n\nஉண்மையான வரிகள்');
    expect(out).toBe('உண்மையான வரிகள்');
  });

  it('drops a markdown/"copy-paste" style label (**YouTube Tags** — copy/paste ready:)', () => {
    const out = stripScaffoldingLabels('**YouTube Tags** — copy/paste ready:\nreal body');
    expect(out.startsWith('real body')).toBe(true);
  });

  it('drops a bare "Title:" label', () => {
    expect(stripScaffoldingLabels('Title:\nMy Song').trim()).toBe('My Song');
  });

  it('never strips a real first line that merely starts similarly', () => {
    const body = 'Description of a love that never fades, told in old Tamil melody.';
    expect(stripScaffoldingLabels(body)).toBe(body); // long, no colon → kept
  });
});

describe('splitTrailingHashtags', () => {
  it('separates a trailing hashtag block from the body', () => {
    const [main, tags] = splitTrailingHashtags('கதை.\n\nமேலும்.\n\n#Tamilagaval #TamilSong');
    expect(main).toBe('கதை.\n\nமேலும்.');
    expect(tags).toBe('#Tamilagaval #TamilSong');
  });

  it('returns empty tag block when there are no trailing hashtags', () => {
    const [main, tags] = splitTrailingHashtags('just a body, no tags');
    expect(main).toBe('just a body, no tags');
    expect(tags).toBe('');
  });

  it('handles Tamil-script hashtags', () => {
    const [, tags] = splitTrailingHashtags('body\n#காதல்பாடல் #Tamilagaval');
    expect(tags).toBe('#காதல்பாடல் #Tamilagaval');
  });
});

describe('pickThemePlaylist', () => {
  it('maps love/காதல் → Love Songs', () => {
    expect(pickThemePlaylist('காதல்', 'Old-style love')?.label).toMatch(/Love Songs/);
  });
  it('maps mother/அன்னை → Mother & Family', () => {
    expect(pickThemePlaylist('அன்னை', 'A mother’s love')?.label).toMatch(/Mother/);
  });
  it('maps homeland/தாயகம் → Heritage', () => {
    expect(pickThemePlaylist('', 'Homeland nostalgia')?.label).toMatch(/Heritage/);
  });
  it('returns null for an unmapped theme', () => {
    expect(pickThemePlaylist('மகிழ்ச்சி', 'Celebration')).toBeNull();
  });
});

describe('buildDescriptionFooter', () => {
  it('always includes Subscribe, site, All Songs, Latest', () => {
    const f = buildDescriptionFooter();
    expect(f).toContain('sub_confirmation=1');
    expect(f).toContain('tamilagaval.com');
    expect(f).toContain('All Songs');
    expect(f).toContain('Latest');
  });
  it('adds the theme playlist when the emotion/theme matches', () => {
    expect(buildDescriptionFooter({ emotion: 'காதல்' })).toMatch(/Love Songs/);
  });
});

describe('assembleYoutubeDescription', () => {
  const body = 'YouTube Description\n\nஒரு பழைய காலத்து காதல் பாடல்.\n\n#TamilLoveSong #Tamilagaval';

  it('strips the leak, appends the footer, and keeps hashtags LAST', () => {
    const out = assembleYoutubeDescription(body, { emotion: 'காதல்' });
    expect(out).not.toMatch(/^YouTube Description/);
    expect(out).toContain('sub_confirmation=1');
    expect(out).toContain('Love Songs'); // theme playlist
    // hashtags are the final block
    expect(out.trim().endsWith('#TamilLoveSong #Tamilagaval')).toBe(true);
    // footer sits before the hashtags
    expect(out.indexOf('Subscribe')).toBeLessThan(out.indexOf('#TamilLoveSong'));
  });

  it('works when the body has no trailing hashtags', () => {
    const out = assembleYoutubeDescription('ஒரு பாடல்.');
    expect(out).toContain('ஒரு பாடல்.');
    expect(out).toContain('All Songs');
  });
});

describe('permanent credit block (catalogue-drift guard)', () => {
  const FORBIDDEN = ['Music composition: AI-assisted', '100% original', 'Rajeswaran Thangarajah'];

  it('CREDIT_BLOCK is the standardised 4-line wording (rights + copyright)', () => {
    expect(CREDIT_BLOCK).toBe(
      [
        '✍️ Lyrics: Raj (original, all rights reserved)',
        '🎵 Music Production & Creative Direction: TamilAgaval.com',
        '🤖 AI-Assisted Music Production',
        '© 2026 TamilAgaval / Raj Thangarajah',
      ].join('\n')
    );
  });

  it('every assembled description emits the full block incl. rights + copyright lines', () => {
    const out = assembleYoutubeDescription('ஒரு காதல் பாடல்.\n\n#tamilagaval', { emotion: 'love' });
    expect(out).toContain('✍️ Lyrics: Raj (original, all rights reserved)');
    expect(out).toContain('🎵 Music Production & Creative Direction: TamilAgaval.com');
    expect(out).toContain('🤖 AI-Assisted Music Production');
    expect(out).toContain('© 2026 TamilAgaval / Raj Thangarajah');
  });

  it('keeps the approved "(original, all rights reserved)" wording — it is NOT the banned "100% original"', () => {
    const out = assembleYoutubeDescription('வரி.\n\n#t', { emotion: 'love' });
    expect(out).toContain('(original, all rights reserved)');
    expect(out).not.toContain('100% original');
  });

  it('uses the brand name "Raj Thangarajah" in ©, never the full "Rajeswaran Thangarajah"', () => {
    const out = assembleYoutubeDescription('வரி.', { emotion: 'love' });
    expect(out).toContain('Raj Thangarajah');
    expect(out).not.toContain('Rajeswaran Thangarajah');
  });

  it('does NOT emit the forbidden legacy phrases — even when the body contains them', () => {
    const drifted = [
      '🎵 About Tamilagaval',
      'Lyrics & poetry: 100% original, written by Rajeswaran (Raj).',
      'Music composition: AI-assisted.',
      'Written by Rajeswaran Thangarajah.',
      '',
      '#tamilagaval',
    ].join('\n');
    const out = assembleYoutubeDescription(drifted, { emotion: 'love' });
    for (const phrase of FORBIDDEN) {
      expect(out).not.toContain(phrase);
    }
    // …but the canonical block is still present, so the song is still credited.
    expect(out).toContain(CREDIT_BLOCK);
    // hashtags survive at the very end.
    expect(out.trimEnd().endsWith('#tamilagaval')).toBe(true);
  });

  it('stripForbiddenCreditLines drops only the offending lines, keeps real copy', () => {
    const body = 'ஒரு அழகான வரி.\nMusic composition: AI-assisted.\nமற்றொரு வரி.';
    const out = stripForbiddenCreditLines(body);
    expect(out).toContain('ஒரு அழகான வரி.');
    expect(out).toContain('மற்றொரு வரி.');
    expect(out).not.toContain('AI-assisted');
  });

  it('strips the banned "100% original" line but KEEPS the approved rights wording', () => {
    const body = '✍️ Lyrics: Raj (original, all rights reserved)\nLyrics: 100% original\nreal line';
    const out = stripForbiddenCreditLines(body);
    expect(out).toContain('✍️ Lyrics: Raj (original, all rights reserved)');
    expect(out).not.toMatch(/100%\s*original/i);
    expect(out).toContain('real line');
  });
});

describe('WhatsApp channel link (gated on config)', () => {
  const CHANNEL = 'https://whatsapp.com/channel/abc123';

  /**
   * The channel does not exist yet, so SITE.whatsapp.url is ''. Nothing about
   * it may appear in a published description until it is real — a dead "follow
   * us on WhatsApp" line across 80+ videos would be worse than no line at all.
   */
  it('omits the lead entirely while no channel is configured', () => {
    expect(buildDescriptionLead()).toBe('');
    expect(assembleYoutubeDescription('ஒரு பாடல்.\n\n#tamil')).not.toMatch(/WhatsApp/i);
  });

  it('rejects anything that is not a real channel URL', () => {
    expect(buildDescriptionLead('https://wa.me/15551234567')).toBe('');
    expect(buildDescriptionLead('https://tamilagaval.com')).toBe('');
    expect(buildDescriptionLead('')).toBe('');
  });

  it('builds the bilingual ask once a real channel URL is supplied', () => {
    const lead = buildDescriptionLead(CHANNEL);
    expect(lead).toContain(CHANNEL);
    expect(lead).toContain('WhatsApp');
    // Above the fold: YouTube truncates around 150 characters, so an ask that
    // does not fit inside that window is not seen at all.
    expect(lead.length).toBeLessThanOrEqual(150);
  });
});
