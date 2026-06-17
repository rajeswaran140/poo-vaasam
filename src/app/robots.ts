import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/seo';

// Non-public areas kept out of every crawler.
const DISALLOWED_PATHS = ['/admin', '/api/', '/login', '/performers', '/debug', '/debug-auth', '/ai-search'];

// AI model-*training* / dataset crawlers — opt the original Tamil lyrics, poems
// and songs out of training corpora. Deliberately does NOT include the AI
// *answer* engines (PerplexityBot, OAI-SearchBot, ChatGPT-User), which cite and
// drive referral traffic, nor the search crawlers (Googlebot, Bingbot) — so
// discovery and SEO are entirely unaffected.
const AI_TRAINING_CRAWLERS = [
  'GPTBot',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'ClaudeBot',
  'anthropic-ai',
  'Claude-Web',
  'cohere-ai',
  'Bytespider',
  'meta-externalagent',
  'FacebookBot',
  'Amazonbot',
  'Diffbot',
  'PetalBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: DISALLOWED_PATHS,
      },
      {
        userAgent: AI_TRAINING_CRAWLERS,
        disallow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    // `host` intentionally omitted — it's a deprecated, Google-ignored directive
    // (only legacy Yandex ever honored it).
  };
}
