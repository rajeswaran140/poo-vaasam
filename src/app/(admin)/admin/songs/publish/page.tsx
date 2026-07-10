'use client';

/**
 * /admin/songs/publish — one-click "Publish Song".
 *
 * Upload audio + a title (+ optional theme), click Publish, and the server
 * creates the PUBLISHED song, auto-links it to its YouTube upload, derives the
 * duration, generates an AI cover, and fires a deploy — all in one call
 * (POST /api/admin/songs/publish). The older /admin/content/new form stays for
 * full manual control.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Music, Wand2, Rocket, Check, AlertTriangle } from 'lucide-react';
import { TamilInput } from '@/components/admin/TamilInput';
import { MediaUploadField } from '@/components/admin/MediaUploadField';
import { adminFetch } from '@/lib/client-auth';
import { SONG_THEMES, SONG_THEME_LABELS, type SongTheme } from '@/config/song-themes';
import showToast from '@/lib/toast';

interface PublishResult {
  id: string;
  audioDuration: number | null;
  youtubeVideoId: string | null;
  matched: boolean;
  theme: string | null;
  featuredImage: string | null;
  coverError?: string;
  deploy?: { jobId: string | null };
  deployError?: string;
  /** Set when the title was already published — a retry-safe no-op, not a new create. */
  alreadyPublished?: boolean;
}

function fmtDuration(secs: number | null): string {
  if (!secs) return '—';
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
}

export default function PublishSongPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [theme, setTheme] = useState<SongTheme | ''>('');
  const [youtubeVideoId, setYoutubeVideoId] = useState('');
  const [generateCover, setGenerateCover] = useState(true);
  const [deploy, setDeploy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);

  const canPublish = title.trim().length > 1 && !!audioUrl && !busy;

  async function onPublish() {
    if (!canPublish) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await adminFetch('/api/admin/songs/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          audioUrl,
          theme: theme || undefined,
          youtubeVideoId: youtubeVideoId.trim() || undefined,
          generateCover,
          deploy,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast.error(data.error || 'Publish failed');
        return;
      }
      const payload = data.data as PublishResult;
      setResult(payload);
      showToast.success(
        payload.alreadyPublished
          ? 'இந்தப் பாடல் ஏற்கனவே வெளியிடப்பட்டுள்ளது ✅'
          : 'பாடல் வெளியிடப்பட்டது 🎵'
      );
    } catch {
      showToast.error('Publish failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 font-tamil text-2xl font-bold text-gray-900">
          <Music className="h-6 w-6 text-orange-600" /> பாடல் வெளியிடு
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload audio + title → one click creates, links the YouTube video, derives the
          duration, generates a cover, and deploys.
        </p>
      </div>

      <div className="space-y-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <TamilInput
          label="Title (தலைப்பு)"
          value={title}
          onChange={setTitle}
          placeholder="Type: kaadhal, amma, tamil"
          required
        />

        <MediaUploadField
          kind="audio"
          label="Audio (WAV/MP3)"
          value={audioUrl}
          onChange={setAudioUrl}
          helpText="Duration is read automatically; WAV preferred."
        />

        <div>
          <span className="mb-2 block text-sm font-medium text-gray-700">Theme (வகை)</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTheme('')}
              className={`rounded-full px-3 py-1.5 font-tamil text-sm transition ${theme === '' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              காதல் (default)
            </button>
            {SONG_THEMES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`rounded-full px-3 py-1.5 font-tamil text-sm transition ${theme === t ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                {SONG_THEME_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            YouTube link (optional — auto-matched by title)
          </summary>
          <input
            type="text"
            value={youtubeVideoId}
            onChange={(e) => setYoutubeVideoId(e.target.value)}
            placeholder="11-char video ID (leave blank to auto-match)"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
          />
        </details>

        <div className="flex flex-wrap gap-5 border-t border-gray-100 pt-4">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={generateCover} onChange={(e) => setGenerateCover(e.target.checked)} className="rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            <Wand2 className="h-4 w-4 text-gray-400" /> Generate cover art
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={deploy} onChange={(e) => setDeploy(e.target.checked)} className="rounded border-gray-300 text-orange-600 focus:ring-orange-500" />
            <Rocket className="h-4 w-4 text-gray-400" /> Deploy (go live, ~5 min)
          </label>
        </div>

        <button
          type="button"
          onClick={onPublish}
          disabled={!canPublish}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 font-tamil font-bold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Music className="h-5 w-5" />}
          {busy ? 'வெளியிடுகிறது…' : 'பாடல் வெளியிடு (Publish)'}
        </button>
      </div>

      {result && (
        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5 text-sm">
          <p className="mb-3 flex items-center gap-2 font-semibold text-green-800">
            <Check className="h-5 w-5" />{' '}
            {result.alreadyPublished ? 'Already published' : 'Published'} — {fmtDuration(result.audioDuration)}
          </p>
          <ul className="space-y-1 text-gray-700">
            <li>YouTube: {result.youtubeVideoId ? `${result.youtubeVideoId}${result.matched ? ' (auto-matched)' : ''}` : 'no link'}</li>
            <li>Theme: {result.theme ?? 'love (default)'}</li>
            <li>
              Cover:{' '}
              {result.featuredImage ? 'generated' : result.coverError ? `failed — ${result.coverError}` : 'skipped'}
            </li>
            <li className="flex items-center gap-1">
              Deploy:{' '}
              {result.deploy ? `job ${result.deploy.jobId} (live in ~5 min)` : result.deployError ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertTriangle className="h-4 w-4" /> {result.deployError} — redeploy manually
                </span>
              ) : 'skipped'}
            </li>
          </ul>
          <div className="mt-4 flex gap-3">
            <button type="button" onClick={() => router.push('/admin/songs')} className="rounded-lg bg-gray-800 px-4 py-2 text-white">
              Go to songs
            </button>
            <button
              type="button"
              onClick={() => { setTitle(''); setAudioUrl(''); setTheme(''); setYoutubeVideoId(''); setResult(null); }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700"
            >
              Publish another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
