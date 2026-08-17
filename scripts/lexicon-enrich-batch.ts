/**
 * lexicon-enrich-batch — propose the missing metadata for the whole lexicon.
 *
 *   npx tsx scripts/lexicon-enrich-batch.ts                  # all entries needing review
 *   npx tsx scripts/lexicon-enrich-batch.ts --limit 100      # a slice, to judge quality first
 *   npx tsx scripts/lexicon-enrich-batch.ts --out ./props    # where the proposals land
 *
 * ⚠️ WRITES NOTHING TO THE DATABASE. Raj's standing instruction is that AI
 * enrichment "must be treated as suggestions and remain editable", so this is
 * deliberately a PROPOSAL GENERATOR: it emits a JSON file and a readable review
 * file, and a human decides what is saved. Wiring it to the repository would
 * turn a model's guess into stored fact, which is precisely the failure the
 * lexicalStatus/confidence design exists to prevent.
 *
 * WHY IT EXISTS: measured 2026-08-17, all 1,047 entries lack themes and Tamil
 * meanings and 1,035 carry a false `sangam` register — an artifact of a form
 * default, not a judgement anyone made.
 *
 * Requires OPENAI_API_KEY (or ANTHROPIC/GEMINI) and AUX_AI_ENGINE. Anthropic is
 * out of credit and no Gemini key exists, so in practice: AUX_AI_ENGINE=openai.
 */
import { writeFileSync } from 'node:fs';
import { LexiconRepository } from '../src/infrastructure/database/LexiconRepository';
import { enrichWords, MAX_ENRICH_BATCH } from '../src/services/ai/lexicon-enrich';
import { isTextEngineConfigured, textEngineModel, selectedTextEngine } from '../src/services/ai/text-engine';

const flag = (name: string, dflt?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

/** Same rule the admin list uses: an entry nobody has finished judging. */
function needsReview(w: { themes?: unknown[]; tamilMeaning?: string; confidence?: string }): boolean {
  return !w.themes?.length || !w.tamilMeaning || !w.confidence;
}

async function main() {
  if (!isTextEngineConfigured()) {
    throw new Error(`AI is not configured for engine "${selectedTextEngine()}" — set AUX_AI_ENGINE and the matching key`);
  }
  const limit = Number(flag('limit', '0'));
  const out = flag('out', './lexicon-proposals')!;

  const repo = new LexiconRepository();
  const all = await repo.findAll();
  let todo = all.filter(needsReview);
  // ⚠️ SPREAD THE BATCH ACROSS THE ALPHABET. findAll returns sorted order, so a
  // batch of 20 is 20 near-identical neighbours (அன்பலை, அன்புடைமை, அன்புநெஞ்சம்…)
  // and the model answers them all the same way. Measured 2026-08-17: a
  // contiguous run of 60 produced 53/53 "literary", 53/53 "established",
  // 53/53 "high" — a constant, not a classification. Interleaving restores the
  // variety the model needs to discriminate.
  if (!process.argv.includes('--contiguous')) {
    const stride = Math.max(1, Math.floor(Math.sqrt(todo.length)));
    const spread: typeof todo = [];
    for (let off = 0; off < stride; off++) for (let i = off; i < todo.length; i += stride) spread.push(todo[i]);
    todo = spread;
  }
  todo = todo.slice(0, limit > 0 ? limit : undefined);
  console.log(`engine ${selectedTextEngine()} · ${textEngineModel()}`);
  console.log(`lexicon ${all.length} · needing review ${all.filter(needsReview).length} · this run ${todo.length}\n`);

  const proposals: Array<Record<string, unknown>> = [];
  let asked = 0;
  let retried = 0;
  const missed: string[] = [];

  for (let i = 0; i < todo.length; i += MAX_ENRICH_BATCH) {
    const batch = todo.slice(i, i + MAX_ENRICH_BATCH);
    asked += batch.length;

    // ⚠️ RETRY. Measured on the 1,047-word run: ~10 batches failed outright and
    // 204 words were lost — not because they were hard, but because the call
    // failed. ஏக்கவிழி, கவியலை and காதல்மொழி had all enriched fine minutes
    // earlier in a smaller run. A whole batch vanishing for a transient reason
    // is worth one more attempt before calling the word unenrichable.
    let got = await enrichWords(batch.map((w) => ({ word: w.word, gloss: w.gloss })));
    for (let attempt = 1; attempt < 3 && got.length === 0; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      got = await enrichWords(batch.map((w) => ({ word: w.word, gloss: w.gloss })));
      if (got.length) retried++;
    }
    proposals.push(...(got as unknown as Array<Record<string, unknown>>));

    // A word asked about but not returned is REPORTED, never quietly lost —
    // a silent shortfall is how enrichment hid that it was dropping 10 of 12.
    const back = new Set(got.map((g) => g.word.normalize('NFC').trim()));
    for (const b of batch) if (!back.has(b.word.normalize('NFC').trim())) missed.push(b.word);

    console.log(`  ${Math.min(i + MAX_ENRICH_BATCH, todo.length)}/${todo.length} · proposals ${proposals.length} · missed ${missed.length} · batches recovered ${retried}`);
  }
  console.log('\n');

  const stat = (pred: (p: Record<string, unknown>) => boolean) =>
    proposals.filter(pred).length;
  console.log(`asked            : ${asked}`);
  console.log(`proposals        : ${proposals.length}`);
  console.log(`no proposal      : ${missed.length}`);
  console.log(`with tamilMeaning: ${stat((p) => !!p.tamilMeaning)}`);
  console.log(`with themes      : ${stat((p) => Array.isArray(p.themes) && (p.themes as unknown[]).length > 0)}`);
  console.log(`with confidence  : ${stat((p) => !!p.confidence)}`);

  const regs = new Map<string, number>();
  for (const p of proposals) for (const r of (p.registers as string[]) ?? []) regs.set(r, (regs.get(r) ?? 0) + 1);
  console.log('registers proposed:');
  for (const [r, n] of [...regs].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${r}`);
  const coined = stat((p) => p.lexicalStatus === 'creative-poetic');
  console.log(`flagged creative-poetic (a coined compound, not a dictionary word): ${coined}`);
  console.log(`batches recovered by retry: ${retried}`);

  // ⚠️ NOT EVERY FIELD IS WORTH APPLYING, and the summary must say so rather
  // than let a big total imply that it all is. Measured on the first full run:
  // wordType came back 842 'noun' / 1 'verb' (a 1,047-word poetic lexicon is
  // not 99.9% nouns), and confidence tracked lexicalStatus 1:1 across all 843 —
  // a restatement, not a second judgement. Both are reported so the degeneracy
  // is visible; neither should be bulk-applied while it looks like this.
  const uniformity = (key: string) => {
    const c = new Map<string, number>();
    for (const p of proposals) { const v = String(p[key] ?? '—'); c.set(v, (c.get(v) ?? 0) + 1); }
    const top = [...c].sort((a, b) => b[1] - a[1])[0];
    return top ? `${top[0]} ${((100 * top[1]) / Math.max(1, proposals.length)).toFixed(0)}%` : 'n/a';
  };
  console.log('\nDEGENERACY CHECK — a field pinned near 100%% is a constant, not a judgement:');
  for (const k of ['wordType', 'confidence', 'lexicalStatus', 'registers']) {
    console.log(`   ${k.padEnd(14)} most common: ${uniformity(k)}`);
  }

  writeFileSync(`${out}.json`, JSON.stringify({ proposals, missed }, null, 2), 'utf8');
  const lines = proposals.map((p) => {
    const f = (k: string) => (Array.isArray(p[k]) ? (p[k] as string[]).join(', ') : (p[k] as string) ?? '');
    return [p.word, f('tamilMeaning'), f('gloss'), f('registers'), f('wordType'), f('lexicalStatus'), f('confidence'), f('themes')]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');
  });
  writeFileSync(`${out}.csv`, ['word,tamilMeaning,gloss,registers,wordType,lexicalStatus,confidence,themes', ...lines].join('\n'), 'utf8');
  console.log(`\nwrote ${out}.json and ${out}.csv — NOTHING was written to the database`);
}

main().catch((err) => { console.error(err); process.exit(1); });
