/**
 * Serialise data for embedding inside a <script> tag. `JSON.stringify` does NOT
 * escape `<`, `>` or `&`, so a value containing `</script>` (or `<!--`) would
 * break out of the block and execute as HTML — a stored-XSS vector when the
 * data includes user-authored content (titles, descriptions, etc.). Escaping
 * these to their `\uXXXX` forms keeps the JSON valid while making breakout
 * impossible.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/**
 * Renders a JSON-LD structured-data <script>. Server component.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
