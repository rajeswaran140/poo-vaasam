/**
 * lexicon-audit-report — run the /admin/lexicon data-quality audit from the CLI.
 *
 *   DYNAMODB_TABLE_NAME=TamilWebContent AWS_REGION=ca-central-1 \
 *     npx tsx scripts/lexicon-audit-report.ts
 *
 * ⚠️ READ-ONLY. It calls findAll() and two pure functions. There is no write
 * path in this file at all, which matches the standing constraint the audit
 * module is built around: "Never automatically delete entries. Show proposed
 * corrections for review."
 *
 * WHY IT EXISTS: /admin/lexicon is Cognito-gated, so the report cannot be read
 * from a terminal. This runs the same calls the GET route makes —
 * findAll -> auditLexicon -> sortFindings -> capFindings — so the output is
 * what the page shows, plus the full uncapped counts the page cannot display.
 *
 * It was written to measure the cap, and did: before capFindings existed the
 * route sliced the sorted list flat, and 1,035 high-severity suspicious-sangam
 * findings consumed the entire 500 budget — missing-tamil-meaning (1,047),
 * missing-themes (1,047) and near-duplicate (1) never reached the browser.
 *
 * Going through LexiconRepository (not a raw DynamoDB scan) is load-bearing:
 * fromDBItem runs migrateUsage/resolveRegisters, and the audit's
 * isLegacyDefaultedSangam check reads the migrated shape. A hand-mapped scan
 * would report different sangam numbers than the page does.
 */

import { LexiconRepository } from '../src/infrastructure/database/LexiconRepository';
import { auditLexicon, sortFindings, capFindings, type AuditFinding } from '../src/lib/lexicon-audit';

/** Mirrors the cap in src/app/api/admin/lexicon/audit/route.ts. */
const ROUTE_MAX_FINDINGS = 500;

function bar(n: number, max: number, width = 28): string {
  if (max <= 0) return '';
  return '█'.repeat(Math.max(1, Math.round((n / max) * width)));
}

async function main() {
  const words = await new LexiconRepository().findAll();
  const report = auditLexicon(words);
  const sorted = sortFindings(report.findings);

  const archived = words.filter((w) => w.archived).length;

  console.log('='.repeat(72));
  console.log('LEXICON DATA-QUALITY AUDIT  (read-only — nothing was written)');
  console.log('='.repeat(72));
  console.log(`rows returned by findAll() : ${words.length}`);
  console.log(`archived (skipped by audit): ${archived}`);
  console.log(`entries audited            : ${report.total}`);
  console.log(`total findings             : ${sorted.length}`);
  console.log('');

  console.log('--- by severity ---');
  for (const sev of ['high', 'medium', 'low'] as const) {
    console.log(`  ${sev.padEnd(7)} ${String(report.countsBySeverity[sev] ?? 0).padStart(5)}`);
  }
  console.log('');

  const codes = Object.entries(report.countsByCode).sort((a, b) => b[1] - a[1]);
  const maxCount = codes.length ? codes[0][1] : 0;
  console.log('--- by code ---');
  for (const [code, n] of codes) {
    console.log(`  ${code.padEnd(30)} ${String(n).padStart(5)}  ${bar(n, maxCount)}`);
  }
  console.log('');

  // What the gated page actually renders, vs what exists.
  const shown = capFindings(sorted, ROUTE_MAX_FINDINGS);
  const shownIds = new Set(shown.map((f) => f.ids.join('|') + f.code));
  const hidden = sorted.filter((f) => !shownIds.has(f.ids.join('|') + f.code));
  console.log(`--- what the page now returns (capFindings, max ${ROUTE_MAX_FINDINGS}) ---`);
  console.log(`  findings the page can show : ${shown.length}`);
  console.log(`  findings truncated away    : ${hidden.length}`);
  const codesIn = (f: readonly AuditFinding[]) => {
    const m = new Map<string, number>();
    for (const x of f) m.set(x.code, (m.get(x.code) ?? 0) + 1);
    return m;
  };
  const shownCodes = codesIn(shown);
  const hiddenCodes = codesIn(hidden);
  console.log(`  codes visible on the page  : ${[...shownCodes.keys()].join(', ') || '(none)'}`);
  const onlyHidden = [...hiddenCodes.keys()].filter((c) => !shownCodes.has(c));
  console.log(`  codes ENTIRELY hidden      : ${onlyHidden.join(', ') || '(none)'}`);
  console.log('');

  console.log('--- one example per code ---');
  const seen = new Set<string>();
  for (const f of sorted) {
    if (seen.has(f.code)) continue;
    seen.add(f.code);
    console.log(`  [${f.severity}] ${f.code}`);
    console.log(`      words   : ${f.words.slice(0, 4).join(', ')}${f.words.length > 4 ? ` (+${f.words.length - 4})` : ''}`);
    console.log(`      message : ${f.message}`);
    console.log(`      proposal: ${f.proposal ? JSON.stringify(f.proposal) : 'null (human decision)'}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
