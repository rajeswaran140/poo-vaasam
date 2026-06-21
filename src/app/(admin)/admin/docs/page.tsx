'use client';

/**
 * Admin — Docs. In-portal documentation viewer. Guides live in the registry
 * (src/content/admin-docs.ts) and render via the dependency-free MarkdownView.
 */

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { ADMIN_DOCS, docsByCategory } from '@/content/admin-docs';
import { MarkdownView } from '@/components/admin/MarkdownView';

export default function DocsPage() {
  const [slug, setSlug] = useState(ADMIN_DOCS[0]?.slug ?? '');
  const grouped = docsByCategory();
  const active = ADMIN_DOCS.find((d) => d.slug === slug) ?? ADMIN_DOCS[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="h-7 w-7 text-purple-600" />
        <h1 className="text-2xl font-bold text-gray-900">Docs</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[14rem_1fr]">
        {/* Index */}
        <nav className="space-y-4">
          {Object.entries(grouped).map(([category, docs]) => (
            <div key={category}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{category}</p>
              <ul className="space-y-1">
                {docs.map((d) => (
                  <li key={d.slug}>
                    <button
                      type="button"
                      onClick={() => setSlug(d.slug)}
                      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                        d.slug === active?.slug
                          ? 'bg-purple-100 font-medium text-purple-800 dark:bg-purple-950/50 dark:text-purple-200'
                          : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      {d.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {ADMIN_DOCS.length === 0 && <p className="text-sm text-gray-400">No docs yet.</p>}
        </nav>

        {/* Content */}
        <article className="min-w-0 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900">
          {active ? (
            <>
              <p className="mb-3 text-xs text-gray-400">Updated {active.updatedAt}</p>
              <MarkdownView md={active.body} />
            </>
          ) : (
            <p className="text-gray-500">Select a document.</p>
          )}
        </article>
      </div>
    </div>
  );
}
