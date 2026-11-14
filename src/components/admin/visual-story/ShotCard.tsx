'use client';

/**
 * One shot in the grid: prompt, cast, its span on the window, the price of a
 * clip (every clip is made at the video rate, whatever the shot's mode),
 * "Generate still" behind a confirm-before-spend dialog (spec §11 layer 2), "Upload picture" for the admin's own image (free, so no
 * dialog), and the candidate strip: tap a still (anywhere on it) or a clip's
 * radio to choose it. The server chooses a shot's first picture by itself.
 *
 * "Make video" and its job's progress live in VideoControls. The strip shows
 * stills and video clips; the radio picks either, and a still can be pinned
 * as the shot's first frame (the next clip starts from it).
 *
 * Every error from this card's own requests (402 over budget, 422 content
 * policy, 503 not connected, 502 upstream, a failed clip…) renders HERE,
 * beside the button that caused it — never in a page banner.
 */

import { useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import { estimateCostUsd } from '@/services/video/cost';
import { clipPriceUsd } from '@/lib/visual-story-video-inputs';
import type { Candidate, Character, GenJob, Shot, VisualStory } from '@/types/visualStory';
import { formatMss } from './WindowPicker';
import { RaiseBudgetButton, Thumb, VideoThumb, shotKey, usd } from './ui-utils';
import { VideoControls } from './VideoControls';

/** The STILL route always bills the Grok image rate, whatever the story's provider. */
export const STILL_PRICE_USD = estimateCostUsd('grok', 'STILL', 1);

/** Mirrors ACCEPTED_PICTURE_TYPES (that module is server-only). */
const PICTURE_ACCEPT = 'image/jpeg,image/png';

async function postJson(url: string, payload: unknown) {
  const res = await adminFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.error || `Request failed (HTTP ${res.status}).`);
  return body;
}

interface Props {
  vsId: string;
  shot: Shot;
  story: VisualStory;
  characters: Character[];
  candidates: Candidate[];
  /** This shot's video jobs from the tree. */
  jobs: GenJob[];
  selected: boolean;
  onEdit: () => void;
  /** Reload the story tree (spend, candidates) after any request settles. */
  onChanged: () => void;
}

export function ShotCard({ vsId, shot, story, characters, candidates, jobs, selected, onEdit, onChanged }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  // Resolution and images as the clip would be sent now (faces → 720p).
  const clipPrice = clipPriceUsd({ characters, candidates, clipQuality: story.clipQuality }, shot);
  const [picking, setPicking] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [uploading, setUploading] = useState(false);
  // The text of the last 402 refusal: "Raise budget" shows only while that message does.
  const [overBudgetMsg, setOverBudgetMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // State updates are async; the ref closes the gap between two fast clicks.
  const inFlight = useRef(false);

  const key = shotKey(shot);
  const label = `Shot ${shot.sceneOrder}.${shot.shotOrder}`;
  const committed = story.spentUsd + story.reservedUsd;
  const after = committed + STILL_PRICE_USD;
  const overCap = after > story.budgetUsdCap + 1e-9;
  const cast = shot.charIds
    .map((id) => characters.find((c) => c.charId === id))
    .filter((c): c is Character => !!c);

  const generate = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setConfirming(false);
    setPending(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots/${key}/still`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        const msg = body?.error || `Could not generate the still (HTTP ${res.status}).`;
        setError(msg);
        setOverBudgetMsg(res.status === 402 ? msg : null);
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setPending(false);
      // Spend moves on success AND on a billed refusal, so always reload.
      onChanged();
    }
  };

  const uploadPicture = async (file: File) => {
    if (uploading) return;
    setUploading(true);
    setError(null);
    const url = `/api/admin/visual-story/${vsId}/shots/${key}/upload`;
    try {
      const presign = await postJson(url, { op: 'presign', contentType: file.type, size: file.size });
      await putToS3(presign.uploadUrl, presign.fields, file, () => {}, new AbortController().signal);
      await postJson(url, { op: 'confirm', key: presign.key });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const pick = async (candId: string) => {
    if (picking) return;
    setPicking(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneOrder: shot.sceneOrder, shotOrder: shot.shotOrder, candId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) setError(body?.error || 'Could not choose that picture or clip.');
      else onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPicking(false);
    }
  };

  const pinFirstFrame = async (candId: string) => {
    if (pinning) return;
    setPinning(true);
    setError(null);
    try {
      const res = await adminFetch(`/api/admin/visual-story/${vsId}/shots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'update', sceneOrder: shot.sceneOrder, shotOrder: shot.shotOrder, firstFrameCandidateId: candId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) setError(body?.error || 'Could not use that picture as the first frame.');
      else onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPinning(false);
    }
  };

  return (
    <article
      aria-label={label}
      className={`space-y-2 rounded-lg border p-3 ${selected ? 'border-blue-500 dark:border-blue-400' : 'border-gray-200 dark:border-gray-700'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        </div>
        <span className="text-xs text-gray-600 dark:text-gray-400">{`${formatMss(shot.startSec)}–${formatMss(shot.startSec + shot.durationSec)}`}</span>
      </div>

      <p className="text-sm text-gray-800 dark:text-gray-200">{shot.visualPrompt}</p>

      {cast.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {cast.map((c) => (
            <li key={c.charId} className="rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800 dark:bg-purple-900 dark:text-purple-200">
              {c.name}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span>{`${shot.durationSec} s · clip ${usd(clipPrice)}`}</span>
        <button type="button" onClick={onEdit} className="min-h-11 min-w-11 text-blue-700 hover:underline lg:min-h-0 lg:min-w-0 dark:text-blue-400">
          Edit
        </button>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => !pending && setConfirming(true)}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Generating…' : `Generate still (${usd(STILL_PRICE_USD)})`}
        </button>
        {confirming && (
          <div role="dialog" aria-label={`Confirm still for ${label}`} className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-gray-800 dark:text-gray-200">{`Generate one still image for ${usd(STILL_PRICE_USD)}?`}</p>
            <p className="text-gray-600 dark:text-gray-400">{`Story total after this: ${usd(after)} of ${usd(story.budgetUsdCap)}`}</p>
            {overCap && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-red-600 dark:text-red-400">That is over this story&apos;s budget cap.</p>
              <RaiseBudgetButton />
            </div>
          )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={generate}
                disabled={overCap}
                className="min-h-11 rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-50 lg:min-h-0"
              >
                Confirm
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-md border border-gray-300 px-3 py-1 text-sm lg:min-h-0 text-gray-700 dark:border-gray-600 dark:text-gray-300">
                Cancel
              </button>
            </div>
          </div>
        )}
        <label className="block text-xs text-gray-700 dark:text-gray-300">
          {uploading ? 'Uploading…' : 'Upload picture (JPEG or PNG, free)'}
          <input
            type="file"
            accept={PICTURE_ACCEPT}
            aria-label={`Upload a picture for ${label}`}
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadPicture(f);
            }}
            className="mt-1 block text-xs"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {error && error === overBudgetMsg && <RaiseBudgetButton />}
      </div>

      <VideoControls
        vsId={vsId}
        shotKey={key}
        label={label}
        durationSec={shot.durationSec}
        priceUsd={clipPrice}
        story={story}
        jobs={jobs}
        onChanged={onChanged}
      />

      {candidates.length > 0 && (
        <fieldset disabled={picking || pinning} className="flex flex-wrap gap-3">
          <legend className="sr-only">{`Chosen picture or clip for ${label}`}</legend>
          {candidates.map((c, i) => {
            const isVideo = c.mode !== 'STILL';
            const name = `${isVideo ? 'Video' : 'Image'} ${i + 1}`;
            const chosen = shot.selectedCandidateId === c.candId;
            const badge = isVideo ? 'Video' : c.providerId === 'upload' ? 'Yours' : 'Still';
            return (
              <div key={c.candId} className="flex flex-col items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
                {/* A clip's player stays outside the label: pressing play must not change the choice. */}
                {isVideo && <VideoThumb s3Key={c.s3Key} label={`Clip ${i + 1} for ${label}`} aspect={story.aspectRatio} />}
                <label
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-md p-1 ${
                    chosen ? 'bg-blue-50 ring-4 ring-blue-600 dark:bg-blue-950 dark:ring-blue-400' : 'ring-1 ring-gray-200 dark:ring-gray-700'
                  }`}
                >
                  {!isVideo && <Thumb s3Key={c.s3Key} alt={`Candidate ${i + 1} for ${label}`} aspect={story.aspectRatio} />}
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700 dark:bg-gray-700 dark:text-gray-200">{badge}</span>
                  <span className="flex min-h-11 items-center gap-1 lg:min-h-0">
                    <input
                      type="radio"
                      name={`pick-${key}`}
                      aria-label={name}
                      checked={chosen}
                      onChange={() => pick(c.candId)}
                      className="h-5 w-5 lg:h-auto lg:w-auto"
                    />
                    {chosen ? <span className="font-semibold text-blue-800 dark:text-blue-300">✓ Chosen</span> : 'Tap to choose'}
                  </span>
                </label>
                {!isVideo &&
                  (shot.firstFrameCandidateId === c.candId ? (
                    <span className="font-medium text-green-700 dark:text-green-400">First frame</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => pinFirstFrame(c.candId)}
                      className="min-h-11 text-blue-700 hover:underline disabled:opacity-50 lg:min-h-0 dark:text-blue-400"
                    >
                      Use as first frame
                    </button>
                  ))}
              </div>
            );
          })}
        </fieldset>
      )}
    </article>
  );
}
