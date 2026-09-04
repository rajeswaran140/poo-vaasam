/**
 * LEXICON DATA-QUALITY AUDIT — finds problems, proposes corrections, and
 * changes NOTHING.
 *
 * Raj's constraint is explicit: *"Never automatically delete entries. Show
 * proposed corrections for review."* So every function here is pure and
 * returns findings; applying one is a separate, per-entry, human-confirmed
 * action through the normal update endpoint.
 *
 * ⚠️ THE FINDING THIS EXISTS FOR. The live table holds 1,047 words of which
 * 1,046 say `register: sangam` — not because anyone judged them Sangam, but
 * because every admin form initialised its register state to
 * `LEXICON_REGISTERS[0]`, and `sangam` sorted first. So the single most common
 * finding is `suspicious-sangam`, and it must read as *"nobody has reviewed
 * this"* rather than *"this claim is wrong"* — the poet did not make the claim.
 *
 * Severity is about REVIEW COST, not correctness: `high` = the entry asserts
 * something false to a reader; `medium` = it is incomplete in a way that
 * degrades search; `low` = cosmetic.
 */

import {
  HISTORICAL_REGISTERS,
  CONSTRUCTED_STATUSES,
  type LexiconWord,
  type LexiconRegister,
} from '@/types/lexicon';
import { isLegacyDefaultedSangam } from '@/lib/lexicon-migrate';
import { matchKey, tamilFormIssue } from '@/lib/tamil-normalize';

export type AuditCode =
  | 'duplicate-word'
  | 'duplicate-normalized'
  | 'suspicious-sangam'
  | 'unreviewed-historical'
  | 'constructed-marked-historical'
  | 'contradictory-status'
  | 'missing-tamil-meaning'
  | 'missing-gloss'
  | 'missing-themes'
  | 'malformed-tamil'
  | 'near-duplicate'
  | 'inconsistent-registers';

export type AuditSeverity = 'high' | 'medium' | 'low';

export interface AuditFinding {
  code: AuditCode;
  severity: AuditSeverity;
  /** Entries involved. More than one for duplicate/near-duplicate findings. */
  ids: string[];
  words: string[];
  /** What is wrong, in one sentence, addressed to the poet. */
  message: string;
  /** A proposed patch to apply — or null when only a human can decide. */
  proposal: Partial<Pick<LexiconWord, 'registers' | 'lexicalStatus' | 'confidence'>> | null;
}

export interface AuditReport {
  total: number;
  findings: AuditFinding[];
  countsByCode: Record<string, number>;
  countsBySeverity: Record<AuditSeverity, number>;
}

/** Registers that cannot honestly co-exist on one word. */
const CONTRADICTORY_PAIRS: ReadonlyArray<readonly [LexiconRegister, LexiconRegister]> = [
  ['sangam', 'colloquial'],
  ['classical', 'colloquial'],
  ['archaic', 'common'],
  ['archaic', 'colloquial'],
  ['sangam', 'modern-poetic'],
  ['classical', 'modern-poetic'],
];

const GLOSS_PLACEHOLDER = '—';

const hasGloss = (w: LexiconWord) => !!w.gloss && w.gloss.trim() !== '' && w.gloss.trim() !== GLOSS_PLACEHOLDER;

/**
 * Strip the productive suffixes Tamil compounds are built with, to spot two
 * entries that are the same coinage typed slightly differently. Deliberately
 * shallow — this feeds a "look at these two" suggestion, never an auto-merge.
 */
function compoundStem(word: string): string {
  return matchKey(word).replace(/(தல்|த்தல்|ச்சி|ஒளி|ம்)$/u, '');
}

/**
 * Audit the lexicon. Pure: same input, same findings, no clock, no I/O, no LLM.
 * Archived entries are skipped — the poet has already made a decision on them.
 */
export function auditLexicon(words: readonly LexiconWord[]): AuditReport {
  const live = (words ?? []).filter((w) => !w.archived);
  const findings: AuditFinding[] = [];

  // --- duplicates ---------------------------------------------------------
  // Exact (same stored headword) is a plain mistake. Normalized-only (same word
  // once invisible characters are stripped) is the one a human eye cannot see,
  // which is exactly why it needs reporting.
  const byExact = new Map<string, LexiconWord[]>();
  const byNormalized = new Map<string, LexiconWord[]>();
  for (const w of live) {
    const exact = w.word.normalize('NFC').trim();
    const norm = w.normalizedWord || matchKey(w.word);
    byExact.set(exact, [...(byExact.get(exact) ?? []), w]);
    byNormalized.set(norm, [...(byNormalized.get(norm) ?? []), w]);
  }

  for (const [key, group] of byExact) {
    if (group.length > 1) {
      findings.push({
        code: 'duplicate-word',
        severity: 'high',
        ids: group.map((g) => g.id),
        words: group.map((g) => g.word),
        message: `"${key}" is stored ${group.length} times. Keep the fullest entry and delete the rest.`,
        proposal: null,
      });
    }
  }

  for (const [, group] of byNormalized) {
    if (group.length < 2) continue;
    const distinct = new Set(group.map((g) => g.word.normalize('NFC').trim()));
    if (distinct.size < 2) continue; // already reported as an exact duplicate
    findings.push({
      code: 'duplicate-normalized',
      severity: 'high',
      ids: group.map((g) => g.id),
      words: group.map((g) => g.word),
      message: `${[...distinct].join(' / ')} differ only by invisible characters — they are the same word typed on two keyboards.`,
      proposal: null,
    });
  }

  // --- near-duplicate compounds -------------------------------------------
  const byStem = new Map<string, LexiconWord[]>();
  for (const w of live) {
    const stem = compoundStem(w.word);
    if (stem.length < 3) continue; // too short to be a meaningful stem
    byStem.set(stem, [...(byStem.get(stem) ?? []), w]);
  }
  for (const [, group] of byStem) {
    if (group.length < 2) continue;
    if (new Set(group.map((g) => matchKey(g.word))).size < 2) continue;
    findings.push({
      code: 'near-duplicate',
      severity: 'low',
      ids: group.map((g) => g.id),
      words: group.map((g) => g.word),
      message: `${group.map((g) => g.word).join(', ')} share a stem — check they are genuinely different words, not one word entered twice.`,
      proposal: null,
    });
  }

  // --- per-entry findings --------------------------------------------------
  for (const w of live) {
    const registers = w.registers?.length ? w.registers : [w.register];

    // The big one: a `sangam` label nobody chose.
    if (isLegacyDefaultedSangam(w)) {
      findings.push({
        code: 'suspicious-sangam',
        severity: 'high',
        ids: [w.id],
        words: [w.word],
        message:
          `"${w.word}" is filed as sangam but has never been reviewed — this was the old form default, not a judgement. ` +
          `If it is a modern coinage, literary or modern-poetic is the honest label.`,
        proposal: null,
      });
    } else if (registers.some((r) => HISTORICAL_REGISTERS.includes(r)) && !w.confidence) {
      // Any other historical claim without a recorded confidence.
      findings.push({
        code: 'unreviewed-historical',
        severity: 'medium',
        ids: [w.id],
        words: [w.word],
        message: `"${w.word}" claims a historical register (${registers.join('/')}) with no confidence recorded. Add evidence in notes, or lower the claim.`,
        proposal: null,
      });
    }

    // A coined compound cannot also be attested-historical.
    if (w.lexicalStatus && CONSTRUCTED_STATUSES.includes(w.lexicalStatus)) {
      const historical = registers.filter((r) => HISTORICAL_REGISTERS.includes(r));
      if (historical.length) {
        findings.push({
          code: 'constructed-marked-historical',
          severity: 'high',
          ids: [w.id],
          words: [w.word],
          message: `"${w.word}" is marked ${w.lexicalStatus} but filed under ${historical.join('/')}. A coined compound is not historical vocabulary.`,
          proposal: { registers: ['modern-poetic'] },
        });
      }
      if (w.confidence === 'verified') {
        findings.push({
          code: 'contradictory-status',
          severity: 'medium',
          ids: [w.id],
          words: [w.word],
          message: `"${w.word}" is a ${w.lexicalStatus} construction marked "verified". Coinages are experimental by nature.`,
          proposal: { confidence: 'experimental' },
        });
      }
    }

    // Registers that cannot both be true.
    for (const [a, b] of CONTRADICTORY_PAIRS) {
      if (registers.includes(a) && registers.includes(b)) {
        findings.push({
          code: 'inconsistent-registers',
          severity: 'medium',
          ids: [w.id],
          words: [w.word],
          message: `"${w.word}" is filed as both ${a} and ${b}, which cannot both be true.`,
          proposal: null,
        });
      }
    }

    if (!hasGloss(w)) {
      findings.push({
        code: 'missing-gloss',
        severity: 'high',
        ids: [w.id],
        words: [w.word],
        message: `"${w.word}" has no English gloss — it cannot be found by an English search.`,
        proposal: null,
      });
    }

    if (!w.tamilMeaning?.trim()) {
      findings.push({
        code: 'missing-tamil-meaning',
        severity: 'medium',
        ids: [w.id],
        words: [w.word],
        message: `"${w.word}" has no Tamil meaning — the definition a Tamil reader would want.`,
        proposal: null,
      });
    }

    if (!w.themes?.length) {
      findings.push({
        code: 'missing-themes',
        severity: 'medium',
        ids: [w.id],
        words: [w.word],
        message: `"${w.word}" has no themes, so it never appears when browsing by theme.`,
        proposal: null,
      });
    }

    const form = tamilFormIssue(w.word);
    if (form) {
      findings.push({
        code: 'malformed-tamil',
        severity: form.code === 'no-tamil' ? 'low' : 'high',
        ids: [w.id],
        words: [w.word],
        message: `"${w.word}": ${form.message}`,
        proposal: null,
      });
    }
  }

  const countsByCode: Record<string, number> = {};
  const countsBySeverity: Record<AuditSeverity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    countsByCode[f.code] = (countsByCode[f.code] ?? 0) + 1;
    countsBySeverity[f.severity] += 1;
  }

  return { total: live.length, findings, countsByCode, countsBySeverity };
}

/** Severity order for display — worst first, then grouped by code. */
const SEVERITY_ORDER: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };

export function sortFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.code.localeCompare(b.code) ||
      (a.words[0] ?? '').localeCompare(b.words[0] ?? '', 'ta')
  );
}

/**
 * Trim a sorted finding list to `max` while keeping EVERY code represented.
 *
 * A plain `sorted.slice(0, max)` is what the audit route used to do, and on the
 * live lexicon it was silently wrong: ~1,035 high-severity `suspicious-sangam`
 * findings filled the whole 500-item budget, so `missing-themes` (1,047),
 * `missing-tamil-meaning` (1,047) and `near-duplicate` (1) never left the
 * server. The UI builds its filter chips from the UNCAPPED `countsByCode`, so
 * those chips advertised four-figure counts and then rendered an empty list —
 * the one genuinely interesting low-severity finding on the whole lexicon was
 * invisible on every run.
 *
 * Each code gets an equal quota first, then any spare budget goes to the
 * worst-severity leftovers. Result is re-sorted, so callers still get
 * severity-first ordering.
 */
export function capFindings(findings: readonly AuditFinding[], max: number): AuditFinding[] {
  if (max <= 0) return [];
  if (findings.length <= max) return [...findings];

  const byCode = new Map<AuditCode, AuditFinding[]>();
  for (const f of findings) {
    const bucket = byCode.get(f.code);
    if (bucket) bucket.push(f);
    else byCode.set(f.code, [f]);
  }

  // At least one per code, so no filter chip can ever point at an empty set.
  const quota = Math.max(1, Math.floor(max / byCode.size));
  const picked: AuditFinding[] = [];
  const leftovers: AuditFinding[] = [];
  for (const bucket of byCode.values()) {
    picked.push(...bucket.slice(0, quota));
    leftovers.push(...bucket.slice(quota));
  }

  const remaining = max - picked.length;
  if (remaining > 0) picked.push(...sortFindings(leftovers).slice(0, remaining));

  return sortFindings(picked).slice(0, max);
}
