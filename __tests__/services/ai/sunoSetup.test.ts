/**
 * The service's contract, with the model stubbed. What matters here is not the
 * prose it produces but that a returned setup is always CHECKED, that failures
 * degrade to a typed code rather than an exception, and that a truncated
 * arrangement is refused rather than passed on looking complete.
 */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class {
    messages = { create };
  },
}));

const OK_OUTPUT = {
  lyrics_block: '[Intro - Instrumental]\n[Break - Flute Phrase]\n[Chorus - Male Lead]\nவரி ஒன்று\n[Outro - Instrumental]',
  style: `Tamil film ballad, 82 BPM | male baritone lead | bamboo flute motif, acoustic guitar | plate reverb | tender | one continuous take${' , warm'.repeat(60)}`,
  weirdness: 45,
  style_influence: 85,
  exclude: [],
  slider_rationale: 'Dense style prompt, conventional idiom.',
};

const toolResponse = (input: unknown, stop: string = 'tool_use') => ({
  stop_reason: stop,
  content: [{ type: 'tool_use', name: 'submit_suno_setup', input }],
});

const INPUT = {
  lyrics: 'வரி ஒன்று\nவரி இரண்டு',
  style: 'Tamil film ballad',
  instruments: ['Bamboo flute', 'Acoustic guitar'],
  voices: ['Male Baritone'],
  ragas: [],
};

describe('generateSunoSetup', () => {
  const OLD = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    jest.resetModules();
    create.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = OLD;
  });

  const load = async () => (await import('@/services/ai/sunoSetup')).generateSunoSetup;

  it('returns the setup plus deterministic findings and a ready flag', async () => {
    create.mockResolvedValue(toolResponse(OK_OUTPUT));
    const res = await (await load())(INPUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.style_influence).toBe(85);
    expect(Array.isArray(res.findings)).toBe(true);
    expect(res.ready).toBe(true);
  });

  it('still returns the output when a check FAILS, with ready=false', async () => {
    // Regenerating loses work that is mostly right; the writer can fix a
    // contradiction faster by hand, so the output must not be withheld.
    create.mockResolvedValue(
      toolResponse({ ...OK_OUTPUT, exclude: ['bamboo flute'] }) // contradicts the style
    );
    const res = await (await load())(INPUT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ready).toBe(false);
    expect(res.findings.some((f) => f.field === 'exclude' && f.severity === 'error')).toBe(true);
    expect(res.data.lyrics_block).toBeTruthy(); // output preserved
  });

  it('forces the tool so the model cannot answer in prose', async () => {
    create.mockResolvedValue(toolResponse(OK_OUTPUT));
    await (await load())(INPUT);
    const call = create.mock.calls[0][0];
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'submit_suno_setup' });
  });

  it('uses a LOW temperature — arrangement should be reproducible', async () => {
    create.mockResolvedValue(toolResponse(OK_OUTPUT));
    await (await load())(INPUT);
    expect(create.mock.calls[0][0].temperature).toBeLessThanOrEqual(0.4);
  });

  it('passes the available instruments so breaks cannot invent one', async () => {
    create.mockResolvedValue(toolResponse(OK_OUTPUT));
    await (await load())(INPUT);
    const content = create.mock.calls[0][0].messages[0].content as string;
    expect(content).toMatch(/Bamboo flute/);
    expect(content).toMatch(/breaks must use only these/i);
  });

  it('refuses a truncated arrangement rather than returning a short song', async () => {
    create.mockResolvedValue(toolResponse(OK_OUTPUT, 'max_tokens'));
    const res = await (await load())(INPUT);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('bad_response');
    expect(res.error).toMatch(/cut short/i);
  });

  it('rejects invalid input before calling the model', async () => {
    const res = await (await load())({ lyrics: '', style: 'x' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('invalid_input');
    expect(create).not.toHaveBeenCalled();
  });

  it('maps upstream failures to typed codes, never throwing', async () => {
    for (const [status, code] of [
      [401, 'auth'],
      [429, 'rate_limit'],
      [500, 'upstream'],
    ] as const) {
      create.mockReset();
      create.mockRejectedValue(Object.assign(new Error('x'), { status }));
      const res = await (await load())(INPUT);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe(code);
    }
  });

  it('reports not_configured without an API key, and never calls out', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    jest.resetModules();
    const res = await (await load())(INPUT);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('not_configured');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a response with no tool block', async () => {
    create.mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'here you go' }] });
    const res = await (await load())(INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_response');
  });

  it('rejects a tool block that does not match the schema', async () => {
    create.mockResolvedValue(toolResponse({ style: 'only this' }));
    const res = await (await load())(INPUT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('bad_response');
  });
});
