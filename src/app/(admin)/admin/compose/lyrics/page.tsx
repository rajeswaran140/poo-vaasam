/**
 * /admin/compose/lyrics — Lyricist (brief → original Tamil lyrics).
 *
 * Server shell only — all interaction lives in <LyricGeneratorForm>, which
 * calls POST /api/admin/compose/lyrics. Mirrors /admin/compose: a "what this
 * is" header + an env-not-configured banner when ANTHROPIC_API_KEY is missing.
 */

import { LyricGeneratorForm } from '@/components/admin/LyricGeneratorForm';

export default function AdminLyricistPage() {
  const aiReady = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'dummy-key-for-build');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Lyricist</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Describe a song with a <strong>brief</strong> — theme, ranked emotions, register, voice and structure
          (pallavi / anupallavi / number of charanams) plus optional seed words — and get
          <strong> original Tamil lyrics</strong> back. Review the result, then paste it into the{' '}
          <strong>Music Director</strong> to build a full production brief. The inverse of the Music Director,
          closing the loop: brief → lyrics → brief → publish.
        </p>
      </header>

      {!aiReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-semibold">AI not configured</p>
          <p className="mt-1 text-xs">
            Set <code>ANTHROPIC_API_KEY</code> in Amplify env vars and redeploy (or in <code>.env.local</code> for
            local testing). Until then the form below would silently no-op.
          </p>
        </div>
      ) : (
        <LyricGeneratorForm />
      )}
    </div>
  );
}
