import {
  assembleYoutubeDescription,
  buildDescriptionFooter,
  pickThemePlaylist,
  stripScaffoldingLabels,
  splitTrailingHashtags,
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
