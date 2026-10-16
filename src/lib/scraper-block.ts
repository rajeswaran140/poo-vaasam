/**
 * Scraper block — the User-Agents the middleware refuses with a 403.
 *
 * robots.txt only ASKS crawlers to stay out; measured 2026-10-16, GPTBot,
 * Bytespider, python-requests, curl and Scrapy all got a full 200 on /songs.
 * This enforces it for anything that identifies itself honestly. A scraper
 * that spoofs a browser User-Agent still gets through — stopping those needs
 * a WAF rate limit (~US$7/mo), which Raj declined in favour of this free block.
 *
 * Two lists, matched as case-insensitive substrings of the User-Agent:
 *
 * 1. AI_TRAINING_CRAWLERS — the same list robots.txt disallows (it imports it
 *    from here, so the two cannot drift). Some entries (Google-Extended,
 *    Applebot-Extended) are robots.txt-only tokens that never appear in a real
 *    User-Agent, so they match nothing here — that is harmless. ⚠️ Never
 *    "fix" them to `Google` or `Applebot`: that would block Google Search
 *    and Siri.
 *
 * 2. SCRAPING_TOOLS — HTTP libraries and scraping frameworks no browser sends.
 *
 * ⚠️ DELIBERATELY NOT BLOCKED:
 * - `node` / `undici` / `axios` / an EMPTY User-Agent. /videos fetches its own
 *   /api/songs through CloudFront (src/app/videos/page.tsx), at runtime and at
 *   Amplify build time; blocking Node's default UA would empty that page or
 *   fail the build.
 * - AI answer engines (OAI-SearchBot, ChatGPT-User, PerplexityBot) — they cite
 *   and send visitors. Same choice as robots.txt, reconfirmed by Raj 2026-10-16.
 * - Search crawlers and link-preview fetchers (Googlebot, bingbot,
 *   facebookexternalhit, WhatsApp, TelegramBot, Twitterbot, Discordbot).
 *   Note `FacebookBot` (blocked, Meta's AI crawler) is a different string
 *   from `facebookexternalhit` (allowed, WhatsApp/Facebook link previews).
 * - No generic `bot`, `spider` or `crawler` substring — those match Googlebot.
 */

export const AI_TRAINING_CRAWLERS = [
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
  'ImagesiftBot',
  'omgili',
  'Timpibot',
];

export const SCRAPING_TOOLS = [
  'python-requests',
  'python-urllib',
  'python-httpx',
  'aiohttp',
  'Scrapy',
  'curl/',
  'Wget',
  'Go-http-client',
  'libwww-perl',
  'Java/',
  'Apache-HttpClient',
  'okhttp',
  'colly',
  'HeadlessChrome',
  'PhantomJS',
  'scrapy-splash',
  'img2dataset',
];

const BLOCKED_TOKENS = [...AI_TRAINING_CRAWLERS, ...SCRAPING_TOOLS].map((t) => t.toLowerCase());

export function isBlockedScraper(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BLOCKED_TOKENS.some((token) => ua.includes(token));
}
