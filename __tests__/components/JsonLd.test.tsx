/** @jest-environment node */
/**
 * JsonLd — structured-data serialization (audit H1).
 *
 * JSON.stringify does not escape `<`/`>`/`&`, so user-authored content (titles,
 * descriptions) embedded in a JSON-LD <script> could break out via `</script>`.
 * serializeJsonLd must neutralize that while keeping the JSON valid.
 */

import { serializeJsonLd } from '@/components/JsonLd';

it('escapes angle brackets and ampersands to their \\u forms', () => {
  const out = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
  expect(out).not.toContain('</script>');
  expect(out).not.toContain('<');
  expect(out).not.toContain('>');
  expect(out).toContain('\\u003c'); // <
  expect(out).toContain('\\u003e'); // >
});

it('escapes & so HTML entities cannot be introduced', () => {
  const out = serializeJsonLd({ name: 'Rock & Roll' });
  expect(out).toContain('\\u0026');
  expect(out).not.toMatch(/&(?!amp;)/); // no bare ampersand
});

it('still produces JSON that round-trips back to the original value', () => {
  const data = { '@type': 'MusicComposition', name: 'பூ வாசம் <b>', author: { name: 'A & B' } };
  expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
});

it('handles arrays of objects (multiple schemas on one page)', () => {
  const data = [{ '@type': 'Article', headline: '1 < 2' }, { '@type': 'BreadcrumbList' }];
  expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
});
