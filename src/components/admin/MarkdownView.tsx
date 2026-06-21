'use client';

/**
 * Renders the block model from src/lib/markdown-blocks.ts as styled React.
 * Dependency-free; used by the admin Docs viewer.
 */

import { Fragment, useMemo } from 'react';
import { parseMarkdown, parseInline, type Block } from '@/lib/markdown-blocks';

function Inline({ text }: { text: string }) {
  const tokens = parseInline(text);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.type === 'bold') return <strong key={i} className="font-semibold text-gray-900 dark:text-gray-100">{t.text}</strong>;
        if (t.type === 'code') return <code key={i} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em] text-pink-700 dark:bg-gray-800 dark:text-pink-300">{t.text}</code>;
        if (t.type === 'link') return <a key={i} href={t.href} className="text-purple-600 underline hover:text-purple-700 dark:text-purple-400" target="_blank" rel="noopener noreferrer">{t.text}</a>;
        return <Fragment key={i}>{t.text}</Fragment>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const cls = block.level === 1
        ? 'mt-6 mb-3 text-2xl font-bold text-gray-900 dark:text-gray-100'
        : block.level === 2
        ? 'mt-6 mb-2 text-lg font-bold text-gray-900 dark:text-gray-100'
        : 'mt-4 mb-1.5 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
      const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3');
      return <Tag className={cls}><Inline text={block.text} /></Tag>;
    }
    case 'paragraph':
      return <p className="my-2 leading-relaxed text-gray-700 dark:text-gray-300"><Inline text={block.text} /></p>;
    case 'list':
      return block.ordered ? (
        <ol className="my-2 ml-5 list-decimal space-y-1 text-gray-700 dark:text-gray-300">
          {block.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}
        </ol>
      ) : (
        <ul className="my-2 ml-5 list-disc space-y-1 text-gray-700 dark:text-gray-300">
          {block.items.map((it, i) => <li key={i}><Inline text={it} /></li>)}
        </ul>
      );
    case 'quote':
      return <blockquote className="my-3 border-l-4 border-purple-300 bg-purple-50 px-4 py-2 text-gray-700 dark:border-purple-700 dark:bg-purple-950/30 dark:text-gray-300"><Inline text={block.text} /></blockquote>;
    case 'hr':
      return <hr className="my-5 border-gray-200 dark:border-gray-700" />;
    case 'code':
      return <pre className="my-3 overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"><code>{block.text}</code></pre>;
    case 'table':
      return (
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 dark:border-gray-600">
                {block.headers.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold text-gray-700 dark:text-gray-200"><Inline text={h} /></th>)}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-100 dark:border-gray-800">
                  {row.map((c, ci) => <td key={ci} className="px-3 py-2 align-top text-gray-700 dark:text-gray-300"><Inline text={c} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownView({ md }: { md: string }) {
  const blocks = useMemo(() => parseMarkdown(md), [md]);
  return <div className="font-tamil">{blocks.map((b, i) => <BlockView key={i} block={b} />)}</div>;
}
