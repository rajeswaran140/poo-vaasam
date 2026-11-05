'use client';

/**
 * Characters: create one, and attach or remove reference images. Upload is the
 * mastering workspace's presign → browser POST to S3 → confirm flow; previews
 * use the signed `mode=play` URL. Each character's errors render in its own row.
 */

import { useRef, useState } from 'react';
import { adminFetch } from '@/lib/client-auth';
import { putToS3 } from '@/lib/mastering-upload-client';
import type { Character } from '@/types/visualStory';
import { Thumb } from './ShotCard';

/** Mirrors ACCEPTED_REF_TYPES / MAX_REFS_PER_CHARACTER (that module is server-only). */
const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_REFS = 4;

async function post(url: string, payload: unknown) {
  const res = await adminFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) throw new Error(body?.error || `Request failed (HTTP ${res.status}).`);
  return body;
}

function CharacterRow({ vsId, character, onChanged }: { vsId: string; character: Character; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const url = `/api/admin/visual-story/${vsId}/characters/${character.charId}/upload`;
  const refs = character.refImageKeys ?? [];

  const upload = async (file: File) => {
    setBusy('Uploading…');
    setError(null);
    abort.current = new AbortController();
    try {
      const presign = await post(url, { op: 'presign', contentType: file.type, size: file.size });
      await putToS3(presign.uploadUrl, presign.fields, file, () => {}, abort.current.signal);
      await post(url, { op: 'confirm', key: presign.key });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The upload failed.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (key: string) => {
    setBusy('Removing…');
    setError(null);
    try {
      await post(url, { op: 'remove', key });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that image.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{character.name}</p>
        {character.description && <p className="text-xs text-gray-600 dark:text-gray-400">{character.description}</p>}
      </div>
      {refs.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {refs.map((k, i) => (
            <li key={k} className="flex flex-col items-center gap-1">
              <Thumb s3Key={k} alt={`Reference ${i + 1} for ${character.name}`} />
              <button type="button" disabled={!!busy} onClick={() => remove(k)} className="text-xs text-red-700 hover:underline disabled:opacity-50 dark:text-red-400">
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {refs.length < MAX_REFS ? (
        <label className="block text-xs text-gray-700 dark:text-gray-300">
          {`Upload a reference (JPEG, PNG or WebP; ${refs.length} of ${MAX_REFS})`}
          <input
            type="file"
            accept={ACCEPT}
            aria-label={`Upload a reference for ${character.name}`}
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
            className="mt-1 block text-xs"
          />
        </label>
      ) : (
        <p className="text-xs text-gray-600 dark:text-gray-400">{`${MAX_REFS} references — remove one to add another.`}</p>
      )}
      {busy && <p className="text-xs text-gray-600 dark:text-gray-400">{busy}</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </li>
  );
}

export function CharactersPanel({ vsId, characters, onChanged }: { vsId: string; characters: Character[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/api/admin/visual-story/${vsId}/characters`, { op: 'create', name: name.trim(), description: description.trim() });
      setName('');
      setDescription('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the character.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800';

  return (
    <div className="space-y-3">
      {characters.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">No characters yet.</p>}
      <ul className="space-y-2">
        {characters.map((c) => (
          <CharacterRow key={c.charId} vsId={vsId} character={c} onChanged={onChanged} />
        ))}
      </ul>
      <form onSubmit={create} className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">New character</h3>
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Name
          <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} className={field} />
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-300">
          Description
          <textarea rows={2} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} className={field} />
        </label>
        <button type="submit" disabled={!name.trim() || busy} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Adding…' : 'Add character'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
