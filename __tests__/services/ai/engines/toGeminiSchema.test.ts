/** @jest-environment node */
/**
 * Tests for toGeminiSchema — strips JSON Schema keywords Gemini rejects,
 * uppercases types, inlines $ref/$defs, and preserves the brief's real shape.
 */

import { toGeminiSchema } from '@/services/ai/engines/toGeminiSchema';
import { composerAnalysisJsonSchema } from '@/services/ai/composerSchema';

it('uppercases types and strips unsupported keywords', () => {
  const out = toGeminiSchema({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, description: 'a name' },
      age: { type: 'integer', minimum: 0, maximum: 120, default: 1 },
    },
    required: ['name'],
  });
  expect(out).toEqual({
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING', description: 'a name' },
      age: { type: 'INTEGER' },
    },
    required: ['name'],
  });
  expect(out).not.toHaveProperty('$schema');
  expect(out).not.toHaveProperty('additionalProperties');
});

it('recurses into array items and drops minItems', () => {
  const out = toGeminiSchema({
    type: 'array',
    minItems: 1,
    items: { type: 'string', minLength: 1 },
  });
  expect(out).toEqual({ type: 'ARRAY', items: { type: 'STRING' } });
});

it('preserves enum values', () => {
  const out = toGeminiSchema({ type: 'string', enum: ['a', 'b'] });
  expect(out).toEqual({ type: 'STRING', enum: ['a', 'b'] });
});

it('inlines a local $ref against $defs and merges siblings', () => {
  const out = toGeminiSchema({
    type: 'object',
    properties: {
      child: { $ref: '#/$defs/Child', description: 'overrides' },
    },
    $defs: {
      Child: { type: 'object', properties: { x: { type: 'integer', minimum: 0 } }, required: ['x'] },
    },
  });
  expect(out).toEqual({
    type: 'OBJECT',
    properties: {
      child: {
        type: 'OBJECT',
        description: 'overrides',
        properties: { x: { type: 'INTEGER' } },
        required: ['x'],
      },
    },
  });
});

it('maps a nullable union type to a base type + nullable flag', () => {
  expect(toGeminiSchema({ type: ['string', 'null'] })).toEqual({ type: 'STRING', nullable: true });
});

it('converts the real composer brief schema into a clean Gemini schema', () => {
  const out = toGeminiSchema(composerAnalysisJsonSchema);
  expect(out.type).toBe('OBJECT');
  // No JSON-Schema-only keywords survive anywhere in the tree.
  const serialized = JSON.stringify(out);
  for (const banned of ['$schema', '$defs', '$ref', 'additionalProperties', 'minItems', 'minLength', 'minimum', 'maximum', 'default']) {
    expect(serialized).not.toContain(banned);
  }
  // Lowercase JSON Schema type spellings are gone.
  expect(serialized).not.toMatch(/"type":"(object|string|array|integer|number|boolean)"/);
  // Nested object (suno_prompts.items) and its required fields survive.
  const props = out.properties as Record<string, Record<string, unknown>>;
  const sunoItems = props.suno_prompts.items as Record<string, unknown>;
  expect(sunoItems.type).toBe('OBJECT');
  expect(sunoItems.required).toEqual(['style', 'prompt']);
  expect(out.required).toContain('reel');
});
