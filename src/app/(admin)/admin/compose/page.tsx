/**
 * /admin/compose — AI Composer (Phase 2 Studio).
 *
 * Server shell only — all interaction lives in <ComposerForm>. The shell
 * surfaces a clear "what this is" header and an env-not-configured banner
 * when ANTHROPIC_API_KEY is missing, so visitors don't waste a click.
 */

import { ComposerForm } from '@/components/admin/ComposerForm';

// No `revalidate` — this page has no server data; it's a thin shell around
// a client form that calls the admin API.

export default function AdminComposePage() {
  const aiReady = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'dummy-key-for-build');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Music Director</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Paste Tamil lyrics → get a full production brief: ranked emotions, mood, theme, key, BPM, instruments and
          ragas (from a curated India &amp; Sri Lanka catalog), a recommended voice, title candidates, several style-tagged Tamilagaval prompts
          — each with a <strong>readiness check + AI critic</strong> so you vet a prompt <em>before</em> spending a generation credit —
          a thumbnail image prompt, bilingual (Tamil + English) YouTube descriptions, and a Reel/Short idea.
          <strong> Export</strong> any variant as a Tamilagaval pack (Markdown / PDF) for copy-paste, and
          <strong> Save brief</strong> to keep it as the durable, model-agnostic source of truth for the song.
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
