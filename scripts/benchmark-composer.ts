/**
 * Offline composer engine benchmark — Claude (Sonnet 4.6) vs Gemini Flash.
 *
 * Runs a fixed set of sample Tamil lyrics through BOTH engines via the same
 * BriefRequest the production path uses, then validates each result with the
 * brief's Zod schema. Reports per-run latency, token usage, and schema-valid
 * completion, plus a comparison summary. This is the artifact that informs
 * whether Gemini Flash is worth adopting for #131 — it touches no cloud
 * resources and never runs the live worker/prod path.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... GEMINI_API_KEY=... npx tsx scripts/benchmark-composer.ts
 *   # optional: --runs=3  --engines=anthropic,gemini  --out=benchmark.json
 *   # optional: ANTHROPIC_MODEL / GEMINI_MODEL env to override either model
 */

import { getEngine } from '../src/services/ai/engines';
import { buildBriefRequest } from '../src/services/ai/composer';
import { composerAnalysisSchema } from '../src/services/ai/composerSchema';
import { writeFileSync } from 'node:fs';

// A few short, distinct lyric snippets spanning different emotions/themes so
// the comparison isn't tuned to one mood. Kept tiny — this measures the engine,
// not lyric length.
const SAMPLE_LYRICS: { label: string; text: string }[] = [
  { label: 'love', text: 'நிலவே நிலவே வா\nஎன் காதல் தீபம் ஏற்று\nஇரவின் மௌனத்தில் உன் பெயர் சொல்' },
  { label: 'homeland', text: 'என் தாயகமே உன் மண்ணில்\nஎன் மூச்சு கலந்தது\nகடல் தாண்டி வந்தாலும் நெஞ்சம் அங்கே' },
  { label: 'devotional', text: 'அம்மா உந்தன் அருள் வேண்டும்\nஎன் வாழ்வில் ஒளி ஏற்று\nபக்தியின் பாதையில் நட' },
  { label: 'grief', text: 'பிரிவின் வலியில் கண்ணீர்\nஉந்தன் நினைவுகள் மட்டும்\nஇந்த இரவு முடியாதா' },
];

interface Run {
  engine: string;
  model: string;
  lyric: string;
  ms: number;
  ok: boolean;
  schemaValid: boolean;
  code?: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: string | null;
  emotion?: string;
  ragas?: string[];
  bpm?: number;
  sunoVariants?: number;
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
}

async function benchmarkEngine(engineId: string, runs: number): Promise<Run[]> {
  const modelOverride =
    engineId === 'anthropic' ? process.env.ANTHROPIC_MODEL : process.env.GEMINI_MODEL;
  const engine = getEngine(engineId, modelOverride || undefined);

  if (!engine.isConfigured()) {
    console.warn(`\n⚠  ${engineId} (${engine.model}) is not configured — set its API key. Skipping.`);
    return [];
  }

  const results: Run[] = [];
  for (let r = 0; r < runs; r++) {
    for (const { label, text } of SAMPLE_LYRICS) {
      const startedAt = Date.now();
      const res = await engine.generateBrief(buildBriefRequest(text));
      const ms = Date.now() - startedAt;

      if (!res.ok) {
        results.push({ engine: engine.id, model: engine.model, lyric: label, ms, ok: false, schemaValid: false, code: res.code });
        console.log(`  [${engine.id}] ${label} (run ${r + 1}): ✗ ${res.code} in ${ms}ms`);
        continue;
      }

      const parsed = composerAnalysisSchema.safeParse(res.raw);
      const run: Run = {
        engine: engine.id,
        model: engine.model,
        lyric: label,
        ms,
        ok: true,
        schemaValid: parsed.success,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        stopReason: res.stopReason,
      };
      if (parsed.success) {
        run.emotion = parsed.data.emotion;
        run.ragas = parsed.data.suggested_ragas;
        run.bpm = parsed.data.suggested_bpm;
        run.sunoVariants = parsed.data.suno_prompts.length;
      }
      results.push(run);
      console.log(
        `  [${engine.id}] ${label} (run ${r + 1}): ${parsed.success ? '✓' : '✗ schema'} ${ms}ms, ` +
          `${res.usage.outputTokens} out-tok${parsed.success ? `, emotion=${run.emotion}, ragas=${run.ragas?.join('/')}, bpm=${run.bpm}` : ''}`
      );
    }
  }
  return results;
}

function summarize(runs: Run[]) {
  const byEngine = new Map<string, Run[]>();
  for (const run of runs) {
    if (!byEngine.has(run.engine)) byEngine.set(run.engine, []);
    byEngine.get(run.engine)!.push(run);
  }

  const rows: string[] = [];
  rows.push('| Engine | Model | Runs | Valid % | p50 ms | p95 ms | avg out-tok |');
  rows.push('|---|---|---|---|---|---|---|');
  for (const [engineId, list] of byEngine) {
    const model = list[0]?.model ?? '';
    const valid = list.filter((r) => r.schemaValid);
    const latencies = list.map((r) => r.ms).sort((a, b) => a - b);
    const p = (q: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] : 0);
    const avgTok =
      valid.length ? Math.round(valid.reduce((s, r) => s + (r.outputTokens ?? 0), 0) / valid.length) : 0;
    const validPct = list.length ? Math.round((valid.length / list.length) * 100) : 0;
    rows.push(`| ${engineId} | ${model} | ${list.length} | ${validPct}% | ${p(0.5)} | ${p(0.95)} | ${avgTok} |`);
  }
  return rows.join('\n');
}

async function main() {
  const runs = Math.max(1, parseInt(arg('runs', '1'), 10) || 1);
  const engines = arg('engines', 'anthropic,gemini').split(',').map((s) => s.trim()).filter(Boolean);
  const outFile = arg('out', 'composer-benchmark.json');

  console.log(`\nComposer engine benchmark — engines=[${engines.join(', ')}], runs=${runs}, lyrics=${SAMPLE_LYRICS.length}\n`);

  const all: Run[] = [];
  for (const engineId of engines) {
    console.log(`Running ${engineId}…`);
    all.push(...(await benchmarkEngine(engineId, runs)));
  }

  if (!all.length) {
    console.error('\nNo runs completed — check that the engine API keys are set.');
    process.exitCode = 1;
    return;
  }

  const summary = summarize(all);
  console.log(`\n## Comparison\n\n${summary}\n`);

  const out = { generatedAt: new Date().toISOString(), runs, engines, samples: SAMPLE_LYRICS.map((s) => s.label), results: all };
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`Wrote raw results → ${outFile}`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
