'use client';

/**
 * Error boundary for the PUBLIC site.
 *
 * Without this, a runtime error on a song or poem page drops the visitor to
 * Next's unstyled default error screen — English-only, unbranded, with no way
 * back. There was only an `(admin)/error.tsx`, so every visitor-facing route was
 * uncovered.
 *
 * Unlike the admin boundary, this deliberately does NOT render `error.message`:
 * a visitor can do nothing with it, and messages can carry internal detail
 * (query shapes, key names, upstream URLs). The `digest` is shown instead — it
 * is the stable id Next also writes to the server log, so Raj can correlate a
 * reported failure with the log line without anything sensitive reaching the page.
 */

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function PublicError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Server-side errors are already logged by Next; this covers the client half.
    console.error('[public] unhandled error:', error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#fdfaf5] px-4 py-16">
      <div className="w-full max-w-lg text-center">
        <p className="text-5xl mb-6" aria-hidden="true">
          🌸
        </p>

        <h1 className="font-tamil text-2xl sm:text-3xl font-semibold text-gray-900 mb-3">
          ஏதோ ஒரு தவறு நேர்ந்துவிட்டது
        </h1>
        <p className="text-gray-600 mb-8">
          Something went wrong on our side — not on yours.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 transition-colors"
          >
            <span className="font-tamil">மீண்டும் முயற்சியுங்கள்</span>
            <span className="text-purple-200"> · Try again</span>
          </button>

          <Link
            href="/"
            className="px-6 py-3 rounded-lg bg-white border border-gray-300 text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
          >
            <span className="font-tamil">முகப்புக்குச் செல்லுங்கள்</span>
            <span className="text-gray-400"> · Home</span>
          </Link>
        </div>

        {error.digest && (
          <p className="mt-10 text-xs text-gray-400">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
