/** @jest-environment node */
/**
 * robots.txt policy:
 *  - Search/general crawlers (*) may index everything except the non-public
 *    areas (admin/api/login/debug/ai-search).
 *  - AI *training* crawlers are blocked from the whole site, while AI *answer*
 *    engines and search crawlers stay allowed (SEO + referral reach unaffected).
 *  - The deprecated `host` directive is not emitted.
 */

import robots from '@/app/robots';
import { SITE_URL } from '@/lib/seo';

const result = robots();
const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

const wildcardRule = rules.find((r) => r.userAgent === '*')!;
const aiRule = rules.find((r) => Array.isArray(r.userAgent))!;

it('advertises the sitemap and omits the deprecated host directive', () => {
  expect(result.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  expect('host' in result).toBe(false);
});

it('lets the general crawler index the site but not the non-public areas', () => {
  expect(wildcardRule.allow).toBe('/');
  const disallow = wildcardRule.disallow as string[];
  for (const path of ['/admin', '/api/', '/login', '/debug', '/debug-auth', '/ai-search']) {
    expect(disallow).toContain(path);
  }
});

it('blocks AI training crawlers from the whole site', () => {
  const agents = aiRule.userAgent as string[];
  expect(aiRule.disallow).toBe('/');
  for (const bot of ['GPTBot', 'CCBot', 'ClaudeBot', 'Google-Extended', 'Bytespider', 'Amazonbot']) {
    expect(agents).toContain(bot);
  }
  // Allowed: the AI answer engines and search crawlers are NOT in the block list,
  // so they keep crawling (citations/referrals + SEO preserved).
  for (const allowed of ['PerplexityBot', 'OAI-SearchBot', 'ChatGPT-User', 'Googlebot', 'Bingbot']) {
    expect(agents).not.toContain(allowed);
  }
});
