/**
 * Legacy → current vocabulary mapping for the lexicon.
 *
 * Pure functions, applied at READ time (and when validating input), never as a
 * bulk rewrite of the table. That is deliberate: Raj's instruction is "do not
 * destructively migrate or silently reclassify existing data", and the old
 * values are still what is physically stored. A row is only rewritten when he
 * edits it.
 *
 * ⚠️ THE `sangam` PROBLEM — read this before trusting any stored register.
 * The old taxonomy was `['sangam', 'literary', 'village', 'modern', 'devotional']`
 * and every form in the admin UI initialised its register state to
 * `LEXICON_REGISTERS[0]`. So "sangam" was the DEFAULT for the Add form, the
 * Paste-import form, and the AI-suggest panel — not a claim anybody made. On
 * 2026-08-14 the live table held 1,047 words of which **1,046 were `sangam`**,
 * including plainly modern coinages (அகநேசம், அகன்றவெளி, அகமலர்ச்சி).
 *
 * Therefore `sangam` on a legacy row is EVIDENCE OF NOTHING. It is migrated
 * across verbatim (we do not invent a better answer), but `isLegacyDefaulted`
 * marks it so the audit can surface it for review, and the UI can show it as
 * unreviewed rather than as an assertion about Sangam literature.
 */

import {
  LEXICON_REGISTERS,
  LEXICON_USAGES,
  type LexiconRegister,
  type LexiconUsage,
} from '@/types/lexicon-vocabulary';

/**
 * Old register values that no longer exist, mapped to their nearest current
 * equivalent. Conservative: nothing maps INTO `sangam` or `classical`, because
 * no old value carried enough evidence to justify a historical claim.
 *
 * - `village`    → `regional`      (region-specific spoken usage)
 * - `modern`     → `common`        (contemporary standard Tamil; NOT
 *                                   `modern-poetic`, which asserts a poetic
 *                                   coinage the old value never meant)
 * - `devotional` → `literary`      (there is no devotional register in the new
 *                                   taxonomy; devotion is a THEME. The audit
 *                                   proposes adding the `spirituality` theme.)
 */
const LEGACY_REGISTERS: Record<string, LexiconRegister> = {
  village: 'regional',
  modern: 'common',
  devotional: 'literary',
};

/** Old freshness values → current ones. */
const LEGACY_USAGES: Record<string, LexiconUsage> = {
  neutral: 'normal',
  retire: 'overused',
};

/**
 * The retired values, as tuples, so the Zod schemas can ACCEPT them on the wire
 * and transform them forward. Without this an old client (or an old test, or a
 * replayed request) gets a 400 on vocabulary that used to be valid.
 */
export const LEGACY_REGISTER_VALUES = ['village', 'modern', 'devotional'] as const;
export const LEGACY_USAGE_VALUES = ['neutral', 'retire'] as const;

const isRegister = (v: string): v is LexiconRegister =>
  (LEXICON_REGISTERS as readonly string[]).includes(v);
const isUsage = (v: string): v is LexiconUsage =>
  (LEXICON_USAGES as readonly string[]).includes(v);

/**
 * Map one stored register value to the current taxonomy. Unknown values fall
 * back to `literary` — the mildest register, making no historical or
 * novelty claim — rather than to whatever happens to sort first.
 */
export function migrateRegister(value: unknown): LexiconRegister {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (isRegister(v)) return v;
  return LEGACY_REGISTERS[v] ?? 'literary';
}

/** Map one stored usage value to the current taxonomy. */
export function migrateUsage(value: unknown): LexiconUsage {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (isUsage(v)) return v;
  return LEGACY_USAGES[v] ?? 'normal';
}

/**
 * Resolve the register list for a row, tolerating every shape the table has
 * held: a `registers` array (current), a single `register` string (legacy), or
 * neither. Deduped, order preserved, never empty.
 */
export function resolveRegisters(registers: unknown, register: unknown): LexiconRegister[] {
  const list = Array.isArray(registers) && registers.length ? registers : [register];
  const out: LexiconRegister[] = [];
  for (const r of list) {
    const mapped = migrateRegister(r);
    if (!out.includes(mapped)) out.push(mapped);
  }
  return out.length ? out : ['literary'];
}

/**
 * True when a row's `sangam` register is almost certainly the old form default
 * rather than an editorial judgement: it is a single-register row, it is
 * `sangam`, and nobody has since recorded a confidence for it.
 *
 * Used by the audit to propose review — never to change the value.
 */
export function isLegacyDefaultedSangam(row: {
  registers?: readonly string[];
  register?: string;
  confidence?: string;
}): boolean {
  const regs = resolveRegisters(row.registers, row.register);
  return regs.length === 1 && regs[0] === 'sangam' && !row.confidence;
}
