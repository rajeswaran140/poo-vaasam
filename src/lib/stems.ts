/**
 * Stems — the separate parts (vocals, drums, bass…) TamilAgaval Music exports
 * for a song. One set per saved master, kept under that master's own folder in
 * the mastering workspace so every existing guard (isMasteringKey, the upload
 * policy, the worker's role) applies unchanged.
 *
 * ⚠️ The stems are resynthesised approximations, not extractions (measured
 * 2026-09-19): their sum is NOT the original record. A remix is a new version.
 */
import { MASTERING_PREFIX } from '@/lib/mastering-storage';

export const STEMS_PREFIX = `${MASTERING_PREFIX}stems/`;

/** The master route mints UUIDs. Anything path-like is refused. */
export function isValidMasterJobId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id);
}

export function stemFolderFor(masterJobId: string): string {
  return `${STEMS_PREFIX}${masterJobId}/`;
}

function safeBase(filename: string): string {
  return (
    filename
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-zA-Z0-9-]/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'stem'
  );
}

/** Timestamp + nonce: the same file name uploaded twice is two stems, never one overwritten. */
export function stemUploadKey(masterJobId: string, filename: string, now: number, nonce: string): string {
  return `${stemFolderFor(masterJobId)}${now}_${nonce}_${safeBase(filename)}.wav`;
}

/** The key's base name — unique per upload, and a valid DynamoDB map key. */
export function stemIdFromKey(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1).replace(/\.wav$/i, '');
}

/** A full-quality stem WAV directly in THIS master's folder — not a preview, not a remix, not elsewhere. */
export function isStemKeyFor(masterJobId: string, key: string): boolean {
  if (!isValidMasterJobId(masterJobId) || typeof key !== 'string' || key.includes('..')) return false;
  const folder = stemFolderFor(masterJobId);
  if (!key.startsWith(folder)) return false;
  const rest = key.slice(folder.length);
  return /^[A-Za-z0-9_-]{1,120}\.wav$/i.test(rest);
}

export function stemPreviewKey(stemKey: string): string {
  const slash = stemKey.lastIndexOf('/');
  return `${stemKey.slice(0, slash)}/preview/${stemIdFromKey(stemKey)}.m4a`;
}

/** Never contains "-master": the master route refuses mastering outputs as sources. */
export function stemRemixKey(masterJobId: string, now: number): string {
  return `${stemFolderFor(masterJobId)}remix/${now}-remix.wav`;
}

/** "2_Drums.wav" → "Drums"; "01 - Lead Vocals.WAV" → "Lead Vocals". */
export function guessStemName(filename: string): string {
  const name = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^\s*\d+\s*[-_.)\s]+\s*/, '')
    .replace(/_/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return name || 'Stem';
}
