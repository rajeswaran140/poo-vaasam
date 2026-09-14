import Link from 'next/link';
import { Folder, UploadCloud, ArrowRight } from 'lucide-react';

/**
 * Media Library — NOT BUILT.
 *
 * This page used to render a full-looking dashboard: an "Upload Media" button,
 * media-type stat cards and a drop zone, none of them wired to anything. It is
 * hidden from the sidebar behind FEATURES.ADMIN.MEDIA_LIBRARY (false), but the
 * URL is still reachable, and someone who lands here needs to know within a
 * second that nothing here uploads a file — and where to go instead.
 *
 * Keep this honest until the real thing exists. A convincing mock of a feature
 * that does not work costs more time than an empty page.
 */
export default function MediaLibraryPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-3">
          <Folder className="h-7 w-7 text-gray-400" aria-hidden="true" />
          <h1 className="text-2xl font-bold text-gray-900">Media Library</h1>
        </div>
        <p className="text-gray-600">
          Not built yet. Nothing on this page uploads, lists or deletes a file.
        </p>
      </div>

      <div className="rounded-lg border border-orange-200 bg-orange-50 p-6">
        <div className="mb-2 flex items-center gap-2">
          <UploadCloud className="h-5 w-5 text-orange-600" aria-hidden="true" />
          <h2 className="font-semibold text-gray-900">To upload audio now</h2>
        </div>
        <p className="mb-4 text-sm text-gray-700">
          <strong>Sound Engineering → Bulk upload</strong> takes a whole batch of WAVs into the
          mastering workspace, one at a time, with per-file progress and retry. WAV only, 500 MB each.
        </p>
        <Link
          href="/admin/mastering/bulk"
          className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
        >
          Go to Bulk upload <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <p className="mt-4 text-sm text-gray-600">
          For a single image or audio file attached to a piece of content, use the upload field on
          the content form itself — that one works.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
          If this gets built
        </h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-gray-600">
          <li>Gallery of what is already in S3, with thumbnails</li>
          <li>Search and filter by file type</li>
          <li>Bulk delete — needs a check that no content record still points at the key</li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Hidden from the sidebar by <code>FEATURES.ADMIN.MEDIA_LIBRARY</code>. Flip that to{' '}
          <code>true</code> only once the page does something.
        </p>
      </div>
    </div>
  );
}
