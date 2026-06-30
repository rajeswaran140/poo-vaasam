/**
 * Convert a JSON Schema (as emitted by `z.toJSONSchema`) into the OpenAPI-subset
 * `Schema` shape Gemini's `responseSchema` accepts.
 *
 * Gemini's structured-output schema is NOT full JSON Schema. It rejects (or
 * silently ignores) `$schema`, `$defs`/`$ref`, `additionalProperties`, and the
 * numeric/length constraints (`minItems`, `minLength`, `minimum`, …). It also
 * wants `type` as the uppercase `Type` enum (OBJECT/ARRAY/STRING/…), not the
 * lowercase JSON Schema spelling.
 *
 * This is a pure function (no SDK import) so it's trivially unit-testable. The
 * constraints we strip here are re-enforced anyway by the Zod `safeParse` in
 * composer.ts after the call, so dropping them costs us nothing — the brief
 * contract is still fully validated.
 */

type JsonSchema = Record<string, unknown>;

const TYPE_MAP: Record<string, string> = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  integer: 'INTEGER',
  number: 'NUMBER',
  boolean: 'BOOLEAN',
  null: 'NULL',
};

// Keywords Gemini's responseSchema understands; everything else is dropped.
const KEEP = new Set(['type', 'properties', 'items', 'required', 'enum', 'description', 'nullable', 'format']);

/** Resolve a local `$ref` (e.g. "#/$defs/Foo") against the root `$defs`. */
function deref(node: JsonSchema, root: JsonSchema): JsonSchema {
  const ref = node['$ref'];
  if (typeof ref !== 'string') return node;
  const defs = (root['$defs'] ?? root['definitions']) as Record<string, JsonSchema> | undefined;
  const key = ref.replace(/^#\/\$defs\//, '').replace(/^#\/definitions\//, '');
  const target = defs?.[key];
  // Merge any sibling keywords over the resolved target (siblings win).
  return target ? { ...target, ...node, $ref: undefined } : node;
}

function convertType(type: unknown): { type?: string; nullable?: boolean } {
  // JSON Schema allows `type: ["string", "null"]`; Gemini wants a base type
  // plus `nullable`.
  if (Array.isArray(type)) {
    const nonNull = type.find((t) => t !== 'null');
    const out: { type?: string; nullable?: boolean } = {};
    if (typeof nonNull === 'string' && TYPE_MAP[nonNull]) out.type = TYPE_MAP[nonNull];
    if (type.includes('null')) out.nullable = true;
    return out;
  }
  if (typeof type === 'string' && TYPE_MAP[type]) return { type: TYPE_MAP[type] };
  return {};
}

function convert(node: JsonSchema, root: JsonSchema): JsonSchema {
  const resolved = '$ref' in node ? deref(node, root) : node;
  const out: JsonSchema = {};

  for (const [key, value] of Object.entries(resolved)) {
    if (!KEEP.has(key)) continue;

    if (key === 'type') {
      Object.assign(out, convertType(value));
    } else if (key === 'properties' && value && typeof value === 'object') {
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, JsonSchema>).map(([k, v]) => [k, convert(v, root)])
      );
    } else if (key === 'items' && value && typeof value === 'object') {
      out.items = convert(value as JsonSchema, root);
    } else {
      // type/properties/items handled above; copy the rest (required, enum,
      // description, nullable, format) verbatim.
      out[key] = value;
    }
  }

  return out;
}

/**
 * Sanitize a JSON Schema into a Gemini-compatible `responseSchema` object.
 * Returns a plain object; the caller casts it to the SDK's `Schema` type.
 */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return convert(schema, schema);
}
