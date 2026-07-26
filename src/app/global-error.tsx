'use client';

/**
 * Last-resort error boundary.
 *
 * `error.tsx` sits INSIDE the root layout, so it cannot catch an error thrown by
 * the root layout itself (fonts, providers, analytics). `global-error.tsx`
 * replaces the whole document when that happens — which is why it must render
 * its own <html> and <body>, and why it cannot rely on anything from the layout
 * (no shared fonts, no providers, no Tailwind base classes guaranteed to have
 * loaded). Styling is therefore inline and deliberately minimal.
 *
 * Like the public boundary, this shows `digest` rather than `error.message`.
 */

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="ta">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fdfaf5',
          color: '#1f2937',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            ஏதோ ஒரு தவறு நேர்ந்துவிட்டது
          </h1>
          <p style={{ color: '#4b5563', marginBottom: '2rem' }}>
            Something went wrong. Please try again.
          </p>

          <button
            onClick={reset}
            style={{
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              border: 'none',
              background: '#7c3aed',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            மீண்டும் முயற்சியுங்கள் · Try again
          </button>

          {error.digest && (
            <p style={{ marginTop: '2.5rem', fontSize: '0.75rem', color: '#9ca3af' }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
