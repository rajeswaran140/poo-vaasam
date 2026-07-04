/**
 * Unit tests — src/lib/youtube-funnel.ts (pure conversion-funnel model).
 * Covers stages, traffic-mix labelling/classification, playlist 2nd-song
 * metrics, the returning-viewer proxy, subscribe rates, the per-song converter
 * leaderboard (min-views gate + sort), the leak diagnosis, sample gating, and
 * division-by-zero edges.
 */
import {
  computeFunnel,
  labelTrafficSource,
  MIN_TOTAL_VIEWS,
  MIN_VIEWS_PER_SONG,
  type FunnelInput,
} from '@/lib/youtube-funnel';

function input(overrides: Partial<FunnelInput> = {}): FunnelInput {
  return {
    days: 28,
    channel: {
      views: 10000,
      watchMinutes: 30000,
      averageViewPercentage: 32,
      subscribersGained: 120,
      subscribersLost: 10,
      uniqueViewers: 8000,
    },
    trafficSources: [
      { source: 'RELATED_VIDEO', views: 5000, watchMinutes: 15000 },
      { source: 'PLAYLIST', views: 2500, watchMinutes: 9000 },
      { source: 'SUBSCRIBER', views: 1500, watchMinutes: 5000 },
      { source: 'YT_SEARCH', views: 1000, watchMinutes: 1000 },
    ],
    playlist: {
      views: 2500,
      playlistStarts: 1000,
      viewsPerPlaylistStart: 2.4,
      averageTimeInPlaylistSeconds: 480,
    },
    videos: [
      { videoId: 'good', views: 3000, averageViewPercentage: 40, subscribersGained: 60 }, // 20/1000
      { videoId: 'meh', views: 4000, averageViewPercentage: 25, subscribersGained: 20 }, // 5/1000
      { videoId: 'tiny', views: 10, averageViewPercentage: 90, subscribersGained: 5 }, // below gate
    ],
    ...overrides,
  };
}

describe('stages', () => {
  it('emits the five funnel stages in order with honest units', () => {
    const r = computeFunnel(input());
    expect(r.stages.map((s) => s.key)).toEqual([
      'DISCOVERED',
      'WATCHED',
      'WATCHED_2ND_SONG',
      'RETURNED',
      'SUBSCRIBED',
    ]);
    expect(r.stages[0]).toMatchObject({ value: 10000, unit: 'views', proxy: true }); // impressions Studio-only
    expect(r.stages[1]).toMatchObject({ value: 32, unit: '% avg view' });
    expect(r.stages[2]).toMatchObject({ value: 2.4, unit: 'songs/session' });
    expect(r.stages[4]).toMatchObject({ value: 120, unit: 'subs' });
  });
});

describe('traffic mix', () => {
  it('labels sources, classifies internal vs external, and shares sum ~100', () => {
    const r = computeFunnel(input());
    const bySource = Object.fromEntries(r.trafficMix.map((t) => [t.source, t]));
    expect(bySource['RELATED_VIDEO']).toMatchObject({ label: 'Suggested videos', internal: true, views: 5000 });
    expect(bySource['YT_SEARCH']).toMatchObject({ internal: false });
    expect(r.trafficMix[0].source).toBe('RELATED_VIDEO'); // sorted by views desc
    const sum = r.trafficMix.reduce((s, t) => s + t.sharePct, 0);
    expect(Math.round(sum)).toBe(100);
  });

  it('internal-discovery share = suggested+playlist+subscriber (not search)', () => {
    const r = computeFunnel(input());
    // internal = RELATED_VIDEO 5000 + PLAYLIST 2500 + SUBSCRIBER 1500 = 9000 of 10000 = 90%
    // (YT_SEARCH 1000 is the only external/cold source)
    const internal = r.conversions.find((c) => c.key === 'internal_discovery');
    expect(internal?.ratePct).toBe(90);
  });
});

describe('2nd-song (playlist)', () => {
  it('surfaces views-per-playlist-start, time-in-playlist, and playlist view share', () => {
    const r = computeFunnel(input());
    expect(r.secondSong.viewsPerPlaylistStart).toBe(2.4);
    expect(r.secondSong.averageTimeInPlaylistSeconds).toBe(480);
    expect(r.secondSong.playlistShareOfViewsPct).toBe(25); // 2500/10000
  });

  it('handles a null playlist (no playlist data) as zeros', () => {
    const r = computeFunnel(input({ playlist: null }));
    expect(r.secondSong).toEqual({
      viewsPerPlaylistStart: 0,
      averageTimeInPlaylistSeconds: 0,
      playlistShareOfViewsPct: 0,
    });
  });
});

describe('returned proxy', () => {
  it('subscriber-source share and views-per-unique-viewer', () => {
    const r = computeFunnel(input());
    expect(r.returned.subscriberSourceSharePct).toBe(15); // 1500/10000
    expect(r.returned.viewsPerViewer).toBe(1.3); // 10000/8000
  });

  it('viewsPerViewer is null when unique viewers is unavailable', () => {
    const r = computeFunnel(input({ channel: { ...input().channel, uniqueViewers: null } }));
    expect(r.returned.viewsPerViewer).toBeNull();
  });
});

describe('subscribe', () => {
  it('computes net subs and subs-per-1000-views', () => {
    const r = computeFunnel(input());
    expect(r.subscribe).toMatchObject({
      subscribersGained: 120,
      subscribersLost: 10,
      netSubscribers: 110,
      subsPer1000Views: 12, // 120/10000*1000
    });
    expect(r.conversions.find((c) => c.key === 'watch_to_subscribe')?.ratePct).toBe(1.2); // %
  });
});

describe('top converters', () => {
  it('gates out low-view songs and ranks by subs-per-1000-views', () => {
    const r = computeFunnel(input());
    expect(r.topConverters.map((v) => v.videoId)).toEqual(['good', 'meh']); // 'tiny' gated (10 < 50)
    expect(r.topConverters[0]).toMatchObject({ videoId: 'good', subsPer1000Views: 20 });
    expect(r.topConverters.every((v) => v.views >= MIN_VIEWS_PER_SONG)).toBe(true);
  });
});

describe('leak diagnosis', () => {
  it('flags a WATCHED (retention) leak when avg view % is below floor', () => {
    const r = computeFunnel(input({ channel: { ...input().channel, averageViewPercentage: 18 } }));
    expect(r.leakiestStage?.stageKey).toBe('WATCHED');
  });

  it('flags a 2nd-song leak when playlist songs/session is weak', () => {
    const r = computeFunnel(input({
      channel: { ...input().channel, averageViewPercentage: 45, subscribersGained: 200 },
      playlist: { views: 2500, playlistStarts: 2500, viewsPerPlaylistStart: 1.1, averageTimeInPlaylistSeconds: 120 },
    }));
    expect(r.leakiestStage?.stageKey).toBe('WATCHED_2ND_SONG');
  });

  it('flags a SUBSCRIBE leak when subs-per-1000 is low (healthy watch + playlist)', () => {
    const r = computeFunnel(input({
      channel: { ...input().channel, averageViewPercentage: 45, subscribersGained: 20 }, // 2/1000
    }));
    expect(r.leakiestStage?.stageKey).toBe('SUBSCRIBED');
  });

  it('returns null (no leak) when every stage clears its benchmark', () => {
    const r = computeFunnel(input({
      channel: { ...input().channel, averageViewPercentage: 45, subscribersGained: 200 },
      playlist: { views: 2500, playlistStarts: 800, viewsPerPlaylistStart: 3.1, averageTimeInPlaylistSeconds: 600 },
    }));
    expect(r.leakiestStage).toBeNull();
  });
});

describe('sample gating', () => {
  it('does not diagnose or over-claim below MIN_TOTAL_VIEWS', () => {
    const r = computeFunnel(input({ channel: { ...input().channel, views: MIN_TOTAL_VIEWS - 1 } }));
    expect(r.hasEnoughData).toBe(false);
    expect(r.leakiestStage).toBeNull();
    expect(r.recommendations[0]).toMatch(/need ≥/);
  });

  it('handles zero views without dividing by zero', () => {
    const r = computeFunnel(input({
      channel: { views: 0, watchMinutes: 0, averageViewPercentage: 0, subscribersGained: 0, subscribersLost: 0, uniqueViewers: null },
      trafficSources: [],
      playlist: null,
      videos: [],
    }));
    expect(r.subscribe.subsPer1000Views).toBe(0);
    expect(r.conversions.find((c) => c.key === 'watch_to_subscribe')?.ratePct).toBeNull();
    expect(r.recommendations[0]).toMatch(/No views/);
    expect(r.topConverters).toEqual([]);
  });
});

describe('labelTrafficSource', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(labelTrafficSource('PLAYLIST')).toEqual({ label: 'Playlists', internal: true });
    expect(labelTrafficSource('YT_SEARCH').internal).toBe(false);
    expect(labelTrafficSource('SOME_NEW_CODE')).toEqual({ label: 'SOME_NEW_CODE', internal: false });
    expect(labelTrafficSource('')).toEqual({ label: 'Unknown', internal: false });
  });
});
