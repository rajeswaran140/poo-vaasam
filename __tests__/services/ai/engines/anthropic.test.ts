/** @jest-environment node */
/**
 * Tests for the Anthropic composer engine — forced tool use, raw extraction,
 * truncation + no-tool-block → bad_response, default model (Sonnet 4.6) and
 * override, abort/timeout forwarding, and upstream error classification.
 */

const create = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create },
  })),
}));

import { AnthropicComposerEngine, DEFAULT_ANTHROPIC_MODEL } from '@/services/ai/engines/anthropic';
import type { BriefRequest } from '@/services/ai/engines/types';

const FAKE_KEY = 'sk-ant-test-key';
const originalEnv = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;
});

afterAll(() => {
  process.env.ANTHROPIC_API_KEY = originalEnv;
});

const REQ: BriefRequest = {
  system: 'SYSTEM PROMPT',
  lyrics: 'காதல் வரிகள்',
  jsonSchema: { type: 'object', properties: {}, required: [] },
  toolName: 'submit_brief',
  maxOutputTokens: 6000,
  temperature: 0.4,
  timeoutMs: 60_000,
};

const toolResponse = (input: unknown, extra: Record<string, unknown> = {}) => ({
  content: [{ type: 'tool_use', name: 'submit_brief', input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 120, output_tokens: 1200 },
  ...extra,
});

it('reports not_configured (and never calls the SDK) when the key is missing', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const engine = new AnthropicComposerEngine();
  expect(engine.isConfigured()).toBe(false);
  const r = await engine.generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'not_configured' });
  expect(create).not.toHaveBeenCalled();
});

it('treats the build placeholder key as not configured', () => {
  process.env.ANTHROPIC_API_KEY = 'dummy-key-for-build';
  expect(new AnthropicComposerEngine().isConfigured()).toBe(false);
});

it('returns the raw tool args on a valid tool_use response', async () => {
  create.mockResolvedValueOnce(toolResponse({ emotion: 'காதல்' }));
  const r = await new AnthropicComposerEngine().generateBrief(REQ);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.raw).toEqual({ emotion: 'காதல்' });
    expect(r.usage).toEqual({ inputTokens: 120, outputTokens: 1200 });
    expect(r.stopReason).toBe('tool_use');
  }
});

it('forces tool use with the request tuning and the given schema', async () => {
  create.mockResolvedValueOnce(toolResponse({}));
  await new AnthropicComposerEngine().generateBrief(REQ);
  const args = create.mock.calls[0][0];
  expect(args.model).toBe(DEFAULT_ANTHROPIC_MODEL);
  expect(args.max_tokens).toBe(6000);
  expect(args.temperature).toBe(0.4);
  expect(args.system).toBe('SYSTEM PROMPT');
  expect(args.tool_choice).toEqual({ type: 'tool', name: 'submit_brief' });
  expect(args.tools[0].name).toBe('submit_brief');
  expect(args.tools[0].input_schema).toBe(REQ.jsonSchema);
  expect(args.messages).toEqual([{ role: 'user', content: 'காதல் வரிகள்' }]);
});

it('defaults to Sonnet 4.6 and honours a model override', async () => {
  expect(new AnthropicComposerEngine().model).toBe('claude-sonnet-4-6');
  create.mockResolvedValueOnce(toolResponse({}));
  const engine = new AnthropicComposerEngine('claude-haiku-4-5-20251001');
  expect(engine.model).toBe('claude-haiku-4-5-20251001');
  await engine.generateBrief(REQ);
  expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
});

it('forwards the abort signal and timeout to the SDK call', async () => {
  create.mockResolvedValueOnce(toolResponse({}));
  const ac = new AbortController();
  await new AnthropicComposerEngine().generateBrief({ ...REQ, signal: ac.signal });
  const opts = create.mock.calls[0][1];
  expect(opts.signal).toBe(ac.signal);
  expect(opts.timeout).toBe(60_000);
});

it('classifies a max_tokens truncation as bad_response', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce(toolResponse({}, { stop_reason: 'max_tokens' }));
  const r = await new AnthropicComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('returns bad_response when the model answers with prose (no tool block)', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'here you go' }], stop_reason: 'end_turn', usage: { output_tokens: 30 } });
  const r = await new AnthropicComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'bad_response' });
});

it('maps 401/403 to auth without leaking the raw key message', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('401 {"error":"invalid x-api-key"}'), { status: 401 }));
  const r = await new AnthropicComposerEngine().generateBrief(REQ);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('auth');
    expect(r.error).not.toMatch(/x-api-key/);
  }
});

it('maps 429 to rate_limit', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(Object.assign(new Error('429 too many requests'), { status: 429 }));
  const r = await new AnthropicComposerEngine().generateBrief(REQ);
  expect(r).toMatchObject({ ok: false, code: 'rate_limit' });
});

it('maps a generic failure to upstream without leaking raw detail', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  create.mockRejectedValueOnce(new Error('socket hang up: internal-host:443'));
  const r = await new AnthropicComposerEngine().generateBrief(REQ);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.code).toBe('upstream');
    expect(r.error).not.toMatch(/internal-host/);
  }
});
