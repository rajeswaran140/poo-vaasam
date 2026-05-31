/**
 * /admin/compose — AI Composer (Phase 2 Studio).
 *
 * Server shell only — all interaction lives in <ComposerForm>. The shell
 * surfaces a clear "what this is" header and an env-not-configured banner
 * when ANTHROPIC_API_KEY is missing, so visitors don't waste a click.
 */

import { ComposerForm } from '@/components/admin/ComposerForm';

export const revalidate = 60;

export default function AdminComposePage() {
  const aiReady = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'dummy-key-for-build');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">AI Composer</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Paste Tamil lyrics → get a production brief (emotion, mood, theme, key, BPM, instrumentation), 3 title
          candidates, a SUNO music-generation prompt, and a YouTube description. Copy buttons throughout — nothing is
          saved back to the DB; this is a draft-tool.
        </p>
      </header>

      {!aiReady ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          <p className="font-semibold">AI not configured</p>
          <p className="mt-1 text-xs">
            Set <code>ANTHROPIC_API_KEY</code> in Amplify env vars and redeploy. Until then the form below would
            silently no-op.
          </p>
        </div>
      ) : (
        <ComposerForm />
      )}
    </div>
  );
}
