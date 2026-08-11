/** @jest-environment node */
/**
 * Tests for src/services/ai/lyricCritic.ts — env-gate, input validation,
 * tool-enforced JSON, schema validation (no silent fabrication), truncation
 * detection, abort-signal forwarding, the "feedback not rewrite" + apolitical
 * system rules, prompt threading, and upstream error mapping.
 */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create },
  })),
}));

import { critiqueLyric } from '@/services/ai/lyricCritic';

const FAKE_KEY = 'sk-ant-test-key';
const originalEnv = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
});

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
});

const INPUT = {
  lyrics: 'பல்லவி\nஊருக்குப் போகணும்\nமண்ணை தொடணும்',
  focus: ['meter', 'imagery'] as const,
  notes: 'Does the pallavi carry?',
};

// A complete, schema-valid critique.
const CRITIQUE = {
  overall: 'A tender pallavi; the charanam loses the thread.',
  strengths: ['The மண்வாசம் image is concrete and earned'],
  observations: [{ aspect: 'meter', note: 'Line 3 runs a beat long against lines 1-2' }],
  slackLines: [
    {
      line: 'மண்ணை தொடணும்',
      issue: 'abstract where the rest of the verse is concrete',
      issueType: 'possible_issue',
      confidence: 0.6,
    },
  ],
  wordIdeas: [
    {
      instead_of: 'அழகு',
      consider: ['எழில்', 'சாயல்'],
      why: 'less generic, period-appropriate',
      tradeoff: 'எழில் is more literary but loses the plainness அழகு carries',
    },
  ],
  questions: ['Whose voice is the charanam in — the exile or the land?'],
};

// A Claude response that answers via the forced `submit_critique` tool.
const toolResponse = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'submit_critique', input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 120, output_tokens: 300 },
  ...extra,
});

it('returns not_configured when ANTHROPIC_API_KEY is missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'not_configured' });
  expect(create).not.toHaveBeenCalled();
});

it('rejects empty lyrics as invalid_input (no upstream call)', async () => {
  const r = await critiqueLyric({ lyrics: '   ' });
  expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
  expect(create).not.toHaveBeenCalled();
});

it('rejects an oversized draft as invalid_input', async () => {
  const r = await critiqueLyric({ lyrics: 'அ'.repeat(8001) });
  expect(r).toMatchObject({ ok: false, code: 'invalid_input' });
  expect(create).not.toHaveBeenCalled();
});

it('parses a valid tool_use response into the structured critique', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.overall).toMatch(/tender pallavi/);
    expect(r.data.strengths).toHaveLength(1);
    expect(r.data.observations[0].aspect).toBe('meter');
    expect(r.data.slackLines[0].line).toBe('மண்ணை தொடணும்'); // verbatim line, not a rewrite
    expect(r.data.wordIdeas[0].consider).toEqual(['எழில்', 'சாயல்']);
    expect(r.data.questions).toHaveLength(1);
  }
});

it('accepts a sparse critique — empty lists are well-formed (only overall required)', async () => {
  create.mockResolvedValueOnce(toolResponse({ overall: 'Solid throughout; nothing to flag.' }));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.data.strengths).toEqual([]);
    expect(r.data.slackLines).toEqual([]);
  }
});

it('forces tool use, an analytical temperature, and headroom', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  expect(create).toHaveBeenCalledTimes(1);
  const args = create.mock.calls[0][0] as {
    max_tokens: number;
    temperature: number;
    tools: Array<{ name: string; input_schema: unknown }>;
    tool_choice: { type: string; name: string };
  };
  expect(args.max_tokens).toBeGreaterThanOrEqual(2048);
  expect(args.temperature).toBeLessThanOrEqual(0.5); // analytical, not generative
  expect(args.tool_choice).toEqual({ type: 'tool', name: 'submit_critique' });
  expect(args.tools[0].name).toBe('submit_critique');
  expect(args.tools[0].input_schema).toMatchObject({ type: 'object' });
});

it('threads the draft, focus, and notes into the user message', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  const content = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
  expect(content).toContain('ஊருக்குப் போகணும்'); // the draft
  expect(content).toContain('meter'); // focus
  expect(content).toContain('Does the pallavi carry?'); // notes
});

it('injects the personal lexicon as REFERENCE, not as a replacement shortlist', async () => {
  // This test used to assert "prefer words from this lexicon" — the very wording
  // that caused the critic to reach for உயிர்த்தமிழே against unrelated lines.
  // It was pinning the bug in place, so it is replaced rather than restored.
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT, { lexicon: ['எழில் — beauty [sangam]', 'நிலா [literary]'] });
  const content = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
  expect(content).toContain('எழில் — beauty [sangam]'); // the poet's own words are in the prompt
  expect(content).toMatch(/EVIDENCE OF THE POET'S VOICE/i);
  expect(content).not.toMatch(/prefer words from this lexicon/i);
});

it('omits the lexicon section entirely when none is provided', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  const content = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
  expect(content).not.toMatch(/lexicon/i);
});

it('instructs feedback-not-rewrite and stays apolitical in the system rule', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT);
  const sys = (create.mock.calls[0][0] as { system: string }).system.toLowerCase();
  expect(sys).toContain('apolitical');
  expect(sys).toMatch(/never a rewrite|do not supply replacement|not a ghostwriter/);
});

it('forwards the abort signal to the Anthropic call', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  const ac = new AbortController();
  await critiqueLyric(INPUT, { signal: ac.signal });
  const opts = create.mock.calls[0][1] as { signal?: AbortSignal };
  expect(opts.signal).toBe(ac.signal);
});

it('honours a model override', async () => {
  create.mockResolvedValueOnce(toolResponse(CRITIQUE));
  await critiqueLyric(INPUT, { model: 'claude-haiku-4-5-20251001' });
  expect((create.mock.calls[0][0] as { model: string }).model).toBe('claude-haiku-4-5-20251001');
});

it('returns bad_response when the model answers with prose instead of the tool', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'here is my feedback…' }], stop_reason: 'end_turn', usage: { output_tokens: 50 } });
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('does NOT fabricate — an empty overall is a bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse({ ...CRITIQUE, overall: '' }));
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('detects a max_tokens truncation as a distinct bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse(CRITIQUE, { stop_reason: 'max_tokens' }));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('bad_response');
    expect(r.error).toMatch(/cut off|too long/i);
  }
});

it('maps a generic upstream error to a clean message without leaking raw text', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(new Error('socket hang up: internal-host:443'));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('upstream');
    expect(r.error).not.toMatch(/internal-host/);
  }
});

it('classifies a 401 as an auth error and hides the raw x-api-key message', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('401 {"error":"invalid x-api-key"}'), { status: 401 }));
  const r = await critiqueLyric(INPUT);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('auth');
    expect(r.error).not.toMatch(/x-api-key/);
  }
});

it('classifies a 429 as a rate-limit error', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('429 too many requests'), { status: 429 }));
  const r = await critiqueLyric(INPUT);
  expect(r).toMatchObject({ ok: false, code: 'rate_limit' });
});

/**
 * GROUNDING + WRITER INTENT (added 2026-08-10).
 *
 * The critic used to ask the model to judge "meter/rhythm" and "vocabulary
 * (repetition, register)" from raw text while this repo already computed those
 * exactly — it imported none of the analysers. That was the real source of
 * generic feedback: the model was guessing at facts instead of interpreting
 * them. These tests pin the fix.
 */
const sentPrompt = () => create.mock.calls[0][0].messages[0].content as string;
const sentSystem = () => create.mock.calls[0][0].system as string;

describe('measured-fact grounding', () => {
  const GROUNDED = {
    lyrics: [
      'சாயங்கால வானத்திலே',
      'சாய்ந்த வண்ணம் யாரோ',
      'காதல் வந்த எண்ணத்திலே',
      'சாய்ந்து போனேன் நானோ',
    ].join('\n'),
  };

  it('sends the measured facts BEFORE the lyric, so meter is never guessed', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(GROUNDED);
    const p = sentPrompt();
    expect(p).toMatch(/MEASURED FACTS/);
    expect(p.indexOf('MEASURED FACTS')).toBeLessThan(p.indexOf('சாயங்கால வானத்திலே'));
  });

  it('gives the line length so the model need not count, but never as a metre verdict', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(GROUNDED);
    expect(sentPrompt()).toMatch(/எழுத்து/);
    expect(sentPrompt()).toMatch(/COARSE PROXY, NOT A METRE READING/);
  });

  it('surfaces the sound family, WITHOUT claiming a shared root', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(GROUNDED);
    // சாயங்கால / சாய்ந்த / சாய்ந்து — three distinct forms a repeated-word
    // count misses entirely. But the same detector groups அகம்/அகப்பை, which
    // share no root, so the grounding must describe SOUND only.
    expect(sentPrompt()).toMatch(/OPEN WITH THE SAME SOUND/);
    expect(sentPrompt()).toContain('சாய்ந்து');
    expect(sentPrompt()).toMatch(/NOT evidence of a shared root or etymology/);
  });

  it('tells the model the facts are not up for debate', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(GROUNDED);
    expect(sentSystem()).toMatch(/ground truth/i);
    expect(sentSystem()).toMatch(/Do not re-derive, dispute or re-count/i);
  });

  it('still sends the poet lexicon alongside the grounding', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(GROUNDED, { lexicon: ['எழில் — beauty [literary]'] });
    expect(sentPrompt()).toMatch(/MEASURED FACTS/);
    expect(sentPrompt()).toMatch(/எழில்/);
  });
});

describe('writer-intent rules in the system prompt', () => {
  it('carries the override rule that separates error from artistic choice', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(INPUT);
    const s = sentSystem();
    expect(s).toMatch(/WRITER INTENT/);
    expect(s).toMatch(/do I simply not yet understand why the poet chose it/i);
    expect(s).toMatch(/artistic_choice/);
  });

  it('requires register to be inferred from the song before deviation is judged', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(INPUT);
    expect(sentSystem()).toMatch(/INFER THE SONG'S OWN REGISTER FIRST/);
  });

  it('asks for line, section AND whole-song reading', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(INPUT);
    expect(sentSystem()).toMatch(/THREE levels/);
  });

  it('separates a familiar image from a familiar expression', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(INPUT);
    expect(sentSystem()).toMatch(/familiar IMAGE from a familiar EXPRESSION/);
  });

  it('still forbids rewriting and stays apolitical', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(INPUT);
    expect(sentSystem()).toMatch(/never a rewrite/i);
    expect(sentSystem()).toMatch(/APOLITICAL/);
  });
});

describe('schema now carries uncertainty and cost', () => {
  it('accepts an artistic_choice flagged with a question instead of a downgrade', async () => {
    create.mockResolvedValueOnce(
      toolResponse({
        overall: 'Strong throughout.',
        slackLines: [
          {
            line: 'மெய்யில் உந்தன் நினைவே முந்தும்',
            issue: 'மெய் reads as both body and truth here',
            issueType: 'artistic_choice',
            confidence: 0.35,
            questionForWriter: 'Did you intend மெய் as body or as truth?',
          },
        ],
      })
    );
    const r = await critiqueLyric(INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.slackLines[0].issueType).toBe('artistic_choice');
      expect(r.data.slackLines[0].questionForWriter).toMatch(/body or as truth/);
    }
  });

  it('REJECTS a slack line with no issueType — the classification is mandatory', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    create.mockResolvedValueOnce(
      toolResponse({
        overall: 'ok',
        slackLines: [{ line: 'ஒரு வரி', issue: 'weak', confidence: 0.5 }],
      })
    );
    expect(await critiqueLyric(INPUT)).toMatchObject({ ok: false, code: 'bad_response' });
  });

  it('REJECTS a word idea with no tradeoff — a swap without its cost sands originality', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    create.mockResolvedValueOnce(
      toolResponse({
        overall: 'ok',
        wordIdeas: [{ instead_of: 'முத்தமிழின்', consider: ['உயிர்த்தமிழே'], why: 'sings better' }],
      })
    );
    expect(await critiqueLyric(INPUT)).toMatchObject({ ok: false, code: 'bad_response' });
  });

  it('rejects a confidence outside 0..1', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    create.mockResolvedValueOnce(
      toolResponse({
        overall: 'ok',
        slackLines: [{ line: 'ஒரு வரி', issue: 'weak', issueType: 'likely_error', confidence: 1.7 }],
      })
    );
    expect(await critiqueLyric(INPUT)).toMatchObject({ ok: false, code: 'bad_response' });
  });
});

/**
 * METRE HUMILITY + NO HISTORICAL LABELS (Raj's review, 2026-08-10).
 *
 * The grounded critic started making confident numeric metre claims ("the
 * song's modal line is 6 syllables", "8 syllables", "the melody will rush")
 * and period labels ("இம்மை is a Sangam-register philosophical term"). An
 * எழுத்து count is not Tamil metre — அசை/சீர்/மாத்திரை decide weight — and a
 * period label is a historical-linguistics claim the draft cannot support.
 */

describe('metre + label rules reach the model', () => {
  beforeEach(() => create.mockResolvedValueOnce(toolResponse(CRITIQUE)));

  it('states that an எழுத்து count is not Tamil metre', async () => {
    await critiqueLyric(INPUT);
    const s = (create.mock.calls[0][0] as { system: string }).system;
    expect(s).toMatch(/எழுத்து count is NOT Tamil metre/i);
    expect(s).toContain('அசை');
    expect(s).toContain('மாத்திரை');
  });

  it('forbids predicting a melodic outcome from counts alone', async () => {
    await critiqueLyric(INPUT);
    const s = (create.mock.calls[0][0] as { system: string }).system;
    expect(s).toMatch(/NEVER predict a melodic outcome/i);
    expect(s).toMatch(/requiresMelodyValidation/);
  });

  it('forbids period and corpus labels, and names the safe alternative', async () => {
    await critiqueLyric(INPUT);
    const s = (create.mock.calls[0][0] as { system: string }).system;
    expect(s).toMatch(/NO UNSUPPORTED LINGUISTIC OR HISTORICAL LABELS/i);
    expect(s).toMatch(/Sangam-register term/); // named as a thing NOT to say
    expect(s).toMatch(/markedly literary register/);
  });

  it('sends line length relatively, without a modal-syllable verdict', async () => {
    await critiqueLyric({ lyrics: 'காதல் வா\nமிக நீண்ட ஒரு வரி இது ஆகும் நிஜமாக\nகாதல் வா' });
    const p = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(p).toMatch(/COARSE PROXY, NOT A METRE READING/);
    expect(p).toMatch(/longer|shorter/);
  });
});

describe('requiresMelodyValidation', () => {
  it('accepts a rhythm note the critic marks as needing the tune', async () => {
    create.mockResolvedValueOnce(
      toolResponse({
        overall: 'Strong.',
        slackLines: [
          {
            line: 'முத்தமிழின் மூன்றெழுத்தே',
            issue: 'runs longer than the lines around it',
            issueType: 'possible_issue',
            confidence: 0.4,
            requiresMelodyValidation: true,
          },
        ],
      })
    );
    const r = await critiqueLyric(INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.slackLines[0].requiresMelodyValidation).toBe(true);
  });

  it('stays optional — a non-rhythmic note need not carry it', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    const r = await critiqueLyric(INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.slackLines[0].requiresMelodyValidation).toBeUndefined();
  });
});

/**
 * THIRD REVIEW (Raj, 2026-08-10). Metre humility held; five behaviours left.
 * Each rule below exists because the critic actually did the thing.
 */
describe('third-review guardrails', () => {
  beforeEach(() => create.mockResolvedValueOnce(toolResponse(CRITIQUE)));
  const sys = () => (create.mock.calls[0][0] as { system: string }).system;

  it('forbids treating a one-off image as an inconsistency', async () => {
    // அகப்பை was flagged for a "tonal gap" purely because it appeared once,
    // when the contrast was the point.
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/A ONE-OFF IMAGE IS NOT AN INCONSISTENCY/i);
    expect(sys()).toMatch(/Never flag an image merely for appearing once/i);
  });

  it('forbids frequency claims about Tamil poetry it cannot check', async () => {
    // "appears often in grief lyrics" / "well-worn pairing" — no corpus, no search.
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/NO CORPUS CLAIMS YOU CANNOT SUPPORT/i);
    expect(sys()).toMatch(/well-worn pairing/);
    expect(sys()).toMatch(/familiar semantic field/);
  });

  it('tells the critic to drop a suggestion that loses the line\'s point', async () => {
    // It reasoned "the body's hunger is the point" and offered the swap anyway.
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/DO NOT OFFER IT AT ALL/);
    expect(sys()).toMatch(/EMPTY wordIdeas list is a perfectly good answer/i);
  });

  it('separates what the text says from what the critic infers', async () => {
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/SEPARATE WHAT THE TEXT SAYS FROM WHAT YOU INFER/i);
    expect(sys()).toMatch(/readingLevel/);
    expect(sys()).toMatch(/NEVER appear in `?overall`? phrased as the song's settled meaning/i);
  });

  it('says cliché is not phrase-frequency', async () => {
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/cliché is not phrase-FREQUENCY/i);
  });
});

describe('personal lexicon is voice, not a replacement shortlist', () => {
  it('no longer tells the model to PREFER lexicon words', async () => {
    // The old wording caused overfitting: உயிர்த்தமிழே proposed against
    // unrelated lines, twice in one critique.
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(INPUT, { lexicon: ['உயிர்த்தமிழே — living Tamil [literary]'] });
    const p = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(p).not.toMatch(/PREFER words from this lexicon/i);
    expect(p).toMatch(/EVIDENCE OF THE POET'S VOICE, NOT a set of replacement candidates/i);
    expect(p).toMatch(/NEVER propose the same lexicon word for more than one line/i);
  });

  it('still shows the poet their own words', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    await critiqueLyric(INPUT, { lexicon: ['உயிர்த்தமிழே — living Tamil [literary]'] });
    const p = (create.mock.calls[0][0] as { messages: Array<{ content: string }> }).messages[0].content;
    expect(p).toContain('உயிர்த்தமிழே');
  });
});

describe('readingLevel', () => {
  it('accepts an observation marked as one possible reading among several', async () => {
    create.mockResolvedValueOnce(
      toolResponse({
        overall: 'A grief song that keeps the mother in the present tense.',
        observations: [
          {
            aspect: 'emotion',
            note: 'the final section can be read as consolation offered upward',
            readingLevel: 'possible_reading',
          },
        ],
      })
    );
    const r = await critiqueLyric(INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.observations[0].readingLevel).toBe('possible_reading');
  });

  it('stays optional for plainly descriptive notes', async () => {
    create.mockResolvedValueOnce(toolResponse(CRITIQUE));
    const r = await critiqueLyric(INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.observations[0].readingLevel).toBeUndefined();
  });

  it('rejects an invented tier', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    create.mockResolvedValueOnce(
      toolResponse({ overall: 'ok', observations: [{ aspect: 'emotion', note: 'x', readingLevel: 'certain' }] })
    );
    expect(await critiqueLyric(INPUT)).toMatchObject({ ok: false, code: 'bad_response' });
  });
});

/**
 * FOURTH REVIEW (Raj, 2026-08-10). Each rule below exists because the critic
 * did the thing on a real ammā-song critique.
 */
describe('fourth-review guardrails', () => {
  beforeEach(() => create.mockResolvedValueOnce(toolResponse(CRITIQUE)));
  const sys = () => (create.mock.calls[0][0] as { system: string }).system;

  it('forbids inferring etymology from sound (அகம் / அகப்பை)', async () => {
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/SOUND IS NOT ETYMOLOGY/i);
    expect(sys()).toContain('அகப்பை');
    expect(sys()).toMatch(/never "share a root"/i);
  });

  it('forbids using a Tamil literary term whose definition does not hold', async () => {
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/USE TAMIL LITERARY TERMS ONLY WHEN THE DEFINITION ACTUALLY HOLDS/i);
    expect(sys()).toContain('அந்தாதி'); // named, with its real definition
    expect(sys()).toMatch(/END-RHYME CHAIN, not அந்தாதி/);
  });

  it('requires enumerating a word\'s jobs and SUPPRESSING a damaging swap', async () => {
    await critiqueLyric(INPUT);
    const s = sys();
    expect(s).toMatch(/list every job the original word is doing/i);
    expect(s).toMatch(/DO NOT OUTPUT IT/);
    expect(s).toMatch(/Naming the trade-off is not enough/i);
    expect(s).toContain('சன்னல்'); // the worked example is in the prompt
  });

  it('asks what breaks if nothing changes, and permits silence', async () => {
    await critiqueLyric(INPUT);
    const s = sys();
    expect(s).toMatch(/IF THE POET CHANGES NOTHING HERE, WHAT ACTUALLY GOES WRONG/i);
    expect(s).toMatch(/Do not manufacture criticism to fill a section/i);
    expect(s).toMatch(/Silence beats a weak note/i);
  });

  it('requires questions to clarify meaning rather than supply it', async () => {
    await critiqueLyric(INPUT);
    const s = sys();
    expect(s).toMatch(/A QUESTION MUST CLARIFY THE POET'S MEANING, NOT SUPPLY ONE/i);
    expect(s).toMatch(/puts words in his mouth/i);
  });
});

describe('an entirely empty critique is valid', () => {
  it('accepts a critique that finds nothing to change', async () => {
    // A mature critic must be able to say "nothing material here". If this ever
    // fails, the schema is forcing the model to manufacture criticism.
    create.mockResolvedValueOnce(
      toolResponse({
        overall: 'This is working. Nothing here needs changing.',
        strengths: ['the சன்னல் / மின்னல் / இன்னல் chain carries the whole section'],
        observations: [],
        slackLines: [],
        wordIdeas: [],
        questions: [],
      })
    );
    const r = await critiqueLyric(INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.slackLines).toEqual([]);
      expect(r.data.wordIdeas).toEqual([]);
    }
  });
});

/**
 * FIFTH REVIEW (Raj, 2026-08-10) — Tamil technical terminology and deterministic
 * facts. The literary reasoning is now sound; the failures left were factual.
 */
describe('fifth-review guardrails', () => {
  beforeEach(() => create.mockResolvedValueOnce(toolResponse(CRITIQUE)));
  const sys = () => (create.mock.calls[0][0] as { system: string }).system;

  it('forbids naming a classical prosodic form without its conditions', async () => {
    // "'க' மோனை chains" and a "'ண்'/'ன்' எதுகை web" were stated as fact from
    // what are only positional string matches.
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/NEVER NAME A CLASSICAL TAMIL PROSODIC FORM/i);
    expect(sys()).toMatch(/எதுகை is not "the letter ண் recurs"/);
    expect(sys()).toMatch(/மோனை is not "some lines start with க"/);
  });

  it('forbids stating any number it was not given', async () => {
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/STATE NO NUMBER YOU HAVE NOT BEEN GIVEN/i);
    expect(sys()).toMatch(/five-fold repetition/);
    expect(sys()).toMatch(/Interpret what a count MEANS; never produce one/);
  });

  it('requires checking a quoted word actually carries the sound', async () => {
    await critiqueLyric(INPUT);
    expect(sys()).toMatch(/QUOTE ONLY WHAT IS THERE/i);
    expect(sys()).toContain('செவ்விதழ்'); // the real error, named
  });

  it('separates lexical recurrence from thematic recurrence', async () => {
    await critiqueLyric(INPUT);
    const s = sys();
    expect(s).toMatch(/LEXICAL RECURRENCE IS NOT THEMATIC RECURRENCE/i);
    expect(s).toMatch(/hook word confined to the பல்லவி is often deliberate craft/);
  });

  it('no longer calls the sound groups எதுகை/மோனை families in the ground-truth rule', async () => {
    // That sentence was what authorised the classification in the first place.
    await critiqueLyric(INPUT);
    expect(sys()).not.toMatch(/எதுகை\/மோனை\/இயைபு families/);
    expect(sys()).toMatch(/none of them is a classical prosodic classification/);
  });
});
