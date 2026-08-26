/**
 * ⌘K command palette for the admin.
 *
 * Opens on ⌘K / Ctrl+K (wire-up lives in AdminLayoutClient); shows every page
 * in ADMIN_NAV_ITEMS with fuzzy matching on title, href, subtitle, and
 * keywords. Empty query shows all pages grouped by section; a typed query
 * shows a flat ranked list.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import {
  ADMIN_NAV_ITEMS,
  ADMIN_NAV_SECTIONS,
  type AdminNavItem,
} from '@/config/admin-nav';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Score a nav item against the query. Higher = better match. 0 = no match.
 * Priority: title.startsWith > title.includes > href match > subtitle/keywords.
 */
function scoreItem(item: AdminNavItem, query: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = item.title.toLowerCase();
  const h = item.href.toLowerCase();
  const s = item.subtitle.toLowerCase();
  const k = (item.keywords ?? []).join(' ').toLowerCase();
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 80;
  if (h.includes(q)) return 60;
  if (s.includes(q) || k.includes(q)) return 40;
  return 0;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset transient state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      // Auto-focus after render.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Ranked flat list — used when there's a query. Section-grouped view is
  // computed separately below.
  const ranked: AdminNavItem[] = useMemo(() => {
    if (!query) return ADMIN_NAV_ITEMS;
    return ADMIN_NAV_ITEMS
      .map((item) => ({ item, score: scoreItem(item, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [query]);

  // Clamp highlight into range whenever the result set changes.
  useEffect(() => {
    setHighlight((h) => (ranked.length === 0 ? 0 : Math.min(h, ranked.length - 1)));
  }, [ranked.length]);

  const navigateTo = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (ranked.length === 0 ? 0 : (h + 1) % ranked.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) =>
        ranked.length === 0 ? 0 : (h - 1 + ranked.length) % ranked.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = ranked[highlight];
      if (item) navigateTo(item.href);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  // Scroll the highlighted row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${highlight}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  if (!open) return null;

  const grouped = ADMIN_NAV_SECTIONS.map((section) => ({
    section,
    items: ranked.filter((i) => i.section === section),
  })).filter((g) => g.items.length > 0);

  // When there's a query we render flat (ranked); otherwise grouped by section.
  const showGrouped = !query;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Admin command palette"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Palette panel */}
      <div
        className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl overflow-hidden ring-1 ring-black/10 dark:ring-white/10"
        onKeyDown={onKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <Search className="w-4 h-4 text-gray-400" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            placeholder="Jump to a page…"
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
            aria-label="Search admin pages"
            aria-controls="admin-palette-list"
            aria-activedescendant={
              ranked[highlight] ? `palette-item-${highlight}` : undefined
            }
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
            ESC
          </kbd>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors sm:hidden"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="admin-palette-list"
          role="listbox"
          className="max-h-[60vh] overflow-y-auto py-2"
        >
          {ranked.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No pages match &ldquo;{query}&rdquo;.
            </div>
          ) : showGrouped ? (
            grouped.map(({ section, items }) => (
              <div key={section} className="pb-1">
                <div
                  data-testid={`palette-section-${section}`}
                  className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500"
                >
                  {section}
                </div>
                {items.map((item) => {
                  const idx = ranked.indexOf(item);
                  return (
                    <PaletteRow
                      key={item.href}
                      item={item}
                      index={idx}
                      isActive={idx === highlight}
                      onHover={() => setHighlight(idx)}
                      onSelect={() => navigateTo(item.href)}
                    />
                  );
                })}
              </div>
            ))
          ) : (
            ranked.map((item, idx) => (
              <PaletteRow
                key={item.href}
                item={item}
                index={idx}
                isActive={idx === highlight}
                onHover={() => setHighlight(idx)}
                onSelect={() => navigateTo(item.href)}
              />
            ))
          )}
        </div>

        {/* Footer legend */}
        <div className="flex items-center justify-between gap-4 px-4 py-2 text-[11px] text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/50">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">↑↓</kbd>{' '}
              navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">↵</kbd>{' '}
              open
            </span>
          </div>
          <span>{ranked.length} result{ranked.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}

interface PaletteRowProps {
  item: AdminNavItem;
  index: number;
  isActive: boolean;
  onHover: () => void;
  onSelect: () => void;
}

function PaletteRow({ item, index, isActive, onHover, onSelect }: PaletteRowProps) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      id={`palette-item-${index}`}
      data-index={index}
      role="option"
      aria-selected={isActive}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`w-full text-left flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
        isActive
          ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-900 dark:text-purple-100'
          : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <Icon
        className={`w-4 h-4 flex-shrink-0 ${
          isActive ? 'text-purple-600 dark:text-purple-300' : 'text-gray-400'
        }`}
        aria-hidden
      />
      <span className="flex-1 min-w-0">
        <span className="block font-medium truncate">{item.title}</span>
        <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
          {item.subtitle}
        </span>
      </span>
      <span className="hidden sm:inline text-[10px] text-gray-400 dark:text-gray-500 font-mono">
        {item.href}
      </span>
    </button>
  );
}
