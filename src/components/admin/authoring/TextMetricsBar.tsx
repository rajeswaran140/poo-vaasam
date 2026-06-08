'use client';

/** Word / line / character counts for the body — a basic writer metric. */
import { textMetrics } from '@/lib/content/authoring';

export function TextMetricsBar({ text }: { text: string }) {
  const { words, lines, chars } = textMetrics(text);
  return (
    <p className="text-xs tabular-nums text-gray-400 dark:text-gray-500">
      {words} {words === 1 ? 'word' : 'words'} · {lines} {lines === 1 ? 'line' : 'lines'} · {chars} chars
    </p>
  );
}
