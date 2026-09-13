/**
 * Browser-side upload to the mastering workspace.
 *
 * Extracted from MasteringStudio so the bulk drop zone uploads by exactly the
 * same protocol — presign, then a POST form with the file part LAST. Two
 * implementations of an S3 policy upload would drift, and the failure mode
 * (a 403 with an XML body) is not one you want to debug twice.
 */
import { adminFetch } from '@/lib/client-auth';
import { ACCEPTED_UPLOAD_TYPES } from '@/lib/mastering-storage';

export type UploadKind = 'audio' | 'cover';

/**
 * POST a file straight to S3 under a presigned policy.
 *
 * Uses XMLHttpRequest rather than fetch because only XHR reports upload
 * progress — a 500 MB WAV with no progress bar looks hung.
 */
export function putToS3(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    // Every policy field first, the file part LAST — S3 requires this order.
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded, e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // S3 replies with an XML <Error><Code>…</Code></Error>; surfacing the code
      // turns an opaque "HTTP 403" into "ExpiredToken" / "EntityTooLarge".
      const code = /<Code>([^<]+)<\/Code>/.exec(xhr.responseText ?? '')?.[1];
      reject(new Error(`S3 rejected the upload (HTTP ${xhr.status}${code ? ` — ${code}` : ''}).`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** Presign, then upload. Resolves with the workspace key. */
export async function uploadToWorkspace(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
  kind: UploadKind = 'audio'
): Promise<string> {
  const typeOk = (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(file.type);
  const res = await adminFetch('/api/admin/mastering/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      // A cover's own type is sent through: the server pins it into the S3
      // policy, so an image cannot masquerade as audio/wav.
      contentType: kind === 'cover' ? file.type : typeOk ? file.type : 'audio/wav',
      size: file.size,
      ...(kind === 'cover' ? { kind } : {}),
    }),
    signal,
  });
  const body = await res.json();
  if (!res.ok || !body.success) {
    throw new Error(body.error || `Could not start the upload (HTTP ${res.status}).`);
  }
  await putToS3(body.uploadUrl, body.fields, file, onProgress, signal);
  return body.key as string;
}
