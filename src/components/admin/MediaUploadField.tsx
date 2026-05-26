'use client';

/**
 * MediaUploadField
 *
 * Admin form control for attaching media to content. Lets the editor either
 * upload a file (audio / image / short video preview) straight to S3 via a
 * presigned URL, or paste an existing URL. On a successful upload it calls
 * onChange() with the public S3 URL.
 *
 * NOTE: deliberately does not import s3-client (that would pull the AWS SDK
 * into the browser bundle); the client-side constraints are mirrored here and
 * re-validated server-side in /api/admin/upload.
 */

import { useRef, useState } from 'react';
import { Upload, Loader2, X } from 'lucide-react';
import { adminFetch } from '@/lib/client-auth';

export type MediaKind = 'audio' | 'image' | 'video';

const KIND_CONFIG: Record<MediaKind, { accept: string; maxBytes: number; hint: string }> = {
  audio: {
    accept: 'audio/mpeg,audio/mp3,audio/wav,audio/ogg',
    maxBytes: 1000 * 1024 * 1024,
    hint: 'MP3, WAV or OGG · up to 1000MB',
  },
  image: {
    accept: 'image/jpeg,image/png,image/gif,image/webp',
    maxBytes: 10 * 1024 * 1024,
    hint: 'JPG, PNG, GIF or WEBP · up to 10MB',
  },
  video: {
    accept: 'video/mp4,video/webm,video/quicktime,video/ogg',
    maxBytes: 50 * 1024 * 1024,
    hint: 'Short preview clip — MP4, WEBM or MOV · up to 50MB',
  },
};

interface MediaUploadFieldProps {
  kind: MediaKind;
  label: string;
  value: string;
  onChange: (url: string) => void;
  helpText?: string;
}

export function MediaUploadField({ kind, label, value, onChange, helpText }: MediaUploadFieldProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = KIND_CONFIG[kind];

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    setError(null);

    if (file.size > cfg.maxBytes) {
      setError(`File too large. Maximum ${Math.round(cfg.maxBytes / (1024 * 1024))}MB.`);
      return;
    }

    setUploading(true);
    try {
      // 1. Ask our admin API for a short-lived presigned PUT URL.
      //    adminFetch attaches the Cognito ID token (Bearer) so the server can
      //    authenticate even though Amplify keeps tokens client-side.
      const presignRes = await adminFetch('/api/admin/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          kind,
          size: file.size,
        }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok || !presign.success) {
        throw new Error(presign.error || 'Could not start upload');
      }

      // 2. Upload the file straight to S3 (bypasses the serverless body limit).
      const { uploadUrl, publicUrl, headers } = presign.data;
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers, body: file });
      if (!putRes.ok) {
        throw new Error('Upload to storage failed');
      }

      // 3. Hand the resulting public URL back to the form.
      onChange(publicUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>

      <div className="flex items-center gap-2">
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://… or upload a file →"
          className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-60 whitespace-nowrap"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Uploading…
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" /> Upload
            </>
          )}
        </button>
        {value && !uploading && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="p-3 text-gray-400 hover:text-red-600 transition-colors"
            aria-label={`Remove ${label}`}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={cfg.accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <p className="text-xs text-gray-500 mt-1">{helpText || cfg.hint}</p>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}

      {/* Preview */}
      {value && !error && (
        <div className="mt-3">
          {kind === 'audio' && (
            <audio controls className="w-full" src={value}>
              Your browser does not support audio playback.
            </audio>
          )}
          {kind === 'video' && (
            <video
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-64 rounded-lg bg-black"
              src={value}
            >
              Your browser does not support video playback.
            </video>
          )}
          {kind === 'image' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={`${label} preview`} className="max-h-40 rounded-lg border border-gray-200" />
          )}
        </div>
      )}
    </div>
  );
}
