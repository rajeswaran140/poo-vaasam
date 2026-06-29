/**
 * /admin/compose/critique — Lyric Critic (the poet's own draft → feedback).
 *
 * Server shell only — all interaction lives in <LyricCriticForm>, which calls
 * POST /api/admin/compose/critique. Mirrors /admin/compose/lyrics: a "what this
 * is" header + an env-not-configured banner when ANTHROPIC_API_KEY is missing.
 *
 * This is the AUGMENT-the-craft surface: it coaches, it never writes or rewrites.
 */

import { LyricCriticForm } from '@/components/admin/LyricCriticForm';

export default function AdminLyricCriticPage() {
  const aiReady = Boolean(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'dummy-key-for-build');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Lyric Critic</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Paste <strong>your own</strong> draft lyric and get honest, specific feedback — strengths, lines that go
          slack (with the reason, <strong>never a rewrite</strong>), richer-word ideas to weigh, and questions to push
          your thinking. A sparring partner for your craft: the words stay yours.
        </p>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          A deep read runs in the background — give it <strong>a minute or two</strong> and the feedback appears when
          it&rsquo;s ready (it&rsquo;s safe to keep this tab open). It&rsquo;s a fluent but fallible reader: weigh its
          calls against your own ear — you&rsquo;re the poet.
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
        <LyricCriticForm />
      )}
    </div>
  );
}
