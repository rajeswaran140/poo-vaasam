import type { NextConfig } from "next";

// Content Security Policy — defined in src/config/csp.ts so it can be unit
// tested without booting Next. Relative import: the `@/` alias is not available
// this early (same reason the vanity-path map below is mirrored rather than
// imported).
import { contentSecurityPolicy } from "./src/config/csp";

// Vanity URLs: serve a content item at a pretty path, and 301 its /content/<id>
// URL to the pretty one. Keep in sync with src/config/vanity-paths.ts (next.config
// runs before the @/ alias is available, so the small mapping is mirrored here).
const VANITY = [
  { path: '/thayagam', id: 'cnt_1781049094952_wstyqacm4' }, // எங்கள் தேசம்
];

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,

  // Old /content/<id> URLs permanently redirect to the vanity path…
  async redirects() {
    return VANITY.map((v) => ({
      source: `/content/${v.id}`,
      destination: v.path,
      permanent: true,
    }));
  },
  // …and the vanity path serves the existing content page (URL stays pretty).
  async rewrites() {
    return VANITY.map((v) => ({
      source: v.path,
      destination: `/content/${v.id}`,
    }));
  },

  // Production optimizations
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  compress: true,
  poweredByHeader: false,

  // Bake server-only secrets into the build. Amplify exposes app env vars at
  // BUILD time but not to the SSR runtime, so we inline them here (compile-time
  // substitution). Only server code references these, so they are NOT emitted
  // into client bundles.
  env: {
    GOOGLE_TTS_CREDENTIALS_BASE64: process.env.GOOGLE_TTS_CREDENTIALS_BASE64 || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    // Read at runtime by the /videos Data API fallback (when the RSS feed flakes).
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
    // YouTube Analytics OAuth (owner-scoped reports) + GA4 Data API. Like the
    // other secrets, Amplify's SSR runtime doesn't expose app env vars, so these
    // MUST be inlined or the admin dashboards fall back to "not configured" at
    // runtime — and the per-video retention / recommendations / digest routes
    // (force-dynamic) silently fail. Server-only; not in client bundles.
    // Rotating any of these requires a redeploy to re-inline.
    YOUTUBE_OAUTH_CLIENT_ID: process.env.YOUTUBE_OAUTH_CLIENT_ID || '',
    YOUTUBE_OAUTH_CLIENT_SECRET: process.env.YOUTUBE_OAUTH_CLIENT_SECRET || '',
    YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN || '',
    GA4_PROPERTY_ID: process.env.GA4_PROPERTY_ID || '',
    GA4_SERVICE_ACCOUNT_KEY: process.env.GA4_SERVICE_ACCOUNT_KEY || '',
    // Twitch integration (OAuth + EventSub). Same constraint as the YouTube
    // secrets above: Amplify's SSR runtime does NOT expose app env vars, so a
    // value set only in the Amplify console is `undefined` at runtime and the
    // integration silently reports "Not configured". Server-only; never emitted
    // to client bundles. Rotating any of these requires a redeploy to re-inline.
    //   TWITCH_EVENTSUB_SECRET must be 10-100 ASCII chars (Twitch's rule) and
    //   must match the secret registered with each EventSub subscription —
    //   changing it invalidates existing subscriptions, so re-subscribe after.
    // See docs/TWITCH_INTEGRATION.md.
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID || '',
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET || '',
    TWITCH_EVENTSUB_SECRET: process.env.TWITCH_EVENTSUB_SECRET || '',
    TWITCH_REDIRECT_URI: process.env.TWITCH_REDIRECT_URI || '',
    TWITCH_EVENTSUB_CALLBACK_URL: process.env.TWITCH_EVENTSUB_CALLBACK_URL || '',
    // Web-push (new-song notifications). Server needs all three to sign payloads
    // at runtime; the public key is ALSO exposed to the client via
    // NEXT_PUBLIC_VAPID_PUBLIC_KEY (auto-inlined by Next). Private key is
    // server-only — never in a client bundle.
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
    VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:rajeswaran.pro@gmail.com',
    // DynamoDB access for runtime SSR/API routes (e.g. saving a brief). Amplify's
    // SSR runtime doesn't get a usable role token, so the app key must be inlined
    // (server-only; not emitted to client bundles). Enables runtime DB reads/writes.
    APP_AWS_ACCESS_KEY_ID: process.env.APP_AWS_ACCESS_KEY_ID || '',
    APP_AWS_SECRET_ACCESS_KEY: process.env.APP_AWS_SECRET_ACCESS_KEY || '',
    AWS_REGION: process.env.AWS_REGION || 'ca-central-1',
    DYNAMODB_TABLE_NAME: process.env.DYNAMODB_TABLE_NAME || 'TamilWebContent',
    // Lets the admin "Publish Song" flow trigger a RELEASE deploy so new content
    // goes live (the public pages are build-time). Needs amplify:StartJob on the
    // runtime app user.
    AMPLIFY_APP_ID: process.env.AMPLIFY_APP_ID || 'd3rkmepk4popv0',
    AMPLIFY_BRANCH: process.env.AMPLIFY_BRANCH || 'master',
    // CDN base for serving media (CloudFront, since the S3 bucket is private).
    // MUST be inlined: video thumbnails are built via mediaUrl() at build time,
    // so without this the build falls back to the now-private S3 URL → 403 (the
    // thumbnails silently break, even though song audio/covers — whose CloudFront
    // URLs live in DynamoDB — keep working). Defaults to the distribution domain
    // so a missing env var can't reintroduce the broken S3-direct fallback.
    MEDIA_BASE_URL: process.env.MEDIA_BASE_URL || 'https://d2cdoh43143xxa.cloudfront.net',
    // HMAC secret for the lyrics email-gate signed cookie. Read at runtime by
    // the unlock/read API routes (force-dynamic), so it MUST be inlined like the
    // other server-only secrets. Falls back to an insecure dev default in
    // src/lib/lyrics-gate.ts when unset — set a real value in Amplify for prod.
    LYRICS_GATE_SECRET: process.env.LYRICS_GATE_SECRET || '',
    // Shared secret for the scheduled snapshot jobs (metrics + search-terms).
    // The daily cron sends it as `x-cron-secret`; the routes compare it to
    // process.env.CRON_SECRET. Like the other server-only secrets, Amplify's SSR
    // runtime doesn't expose app env vars, so it MUST be inlined here or the cron
    // path 401s and the diagnostics never accumulate history. Server-only.
    CRON_SECRET: process.env.CRON_SECRET || '',
  },

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    // Next's default deviceSizes top out at 3840, so every <Image> emits ten
    // srcset candidates. On /videos that was 76k characters across 41 images —
    // 17% of the document — and the non-srcset fallback `src` pointed at
    // w=3840, a 3x UPSCALE of a 1280x720 YouTube thumbnail. Capping at 1920
    // drops the candidates no source on the site can fill, while leaving 2x
    // headroom for poem art, hero images and any higher-resolution artwork
    // commissioned later (the setting is site-wide, not just thumbnails).
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // Thumbnails and cover art are immutable for the life of a video id, so
    // re-deriving them every minute only burns optimizer invocations.
    minimumCacheTTL: 604800, // 7 days
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        // Media now serves from CloudFront (MEDIA_BASE_URL); without this the
        // next/image optimizer 400s on every CDN image (video thumbnails on
        // /videos, covers) → blank/black. Wildcard so a distribution swap
        // doesn't reintroduce the breakage.
        protocol: 'https',
        hostname: '**.cloudfront.net',
      },
    ],
  },

  // Security headers
  async headers() {
    return [
      {
        // Status-share clips + their posters are content-stable static files
        // (the filename pins the content), so cache them hard. Without this they
        // were served with the platform default (max-age=5), re-downloading the
        // ~1.3 MB clip on every repeat visit and every Web Share file fetch.
        source: '/clips/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // Public pages are `force-dynamic` (Amplify SSR can't run ISR
        // reliably), so the CDN TTL *is* the freshness mechanism — raising
        // s-maxage would delay new uploads appearing. Instead keep the 5-minute
        // revalidation window and extend stale-while-revalidate to a day: the
        // CDN serves the cached copy immediately and refreshes in the
        // background. At this traffic level (~170 sessions/month) a 300s cache
        // is nearly always cold, so visitors were paying a ~5.8s Lambda cold
        // start; with SWR they get ~60ms and the next request gets fresh data.
        //
        // SCOPE MATTERS: this must never reach /api or /admin — a shared
        // `public` cache in front of an authenticated response is a data-leak
        // bug, not a perf win. The negative lookahead excludes those, plus the
        // other non-public prefixes already hidden in robots.txt.
        source: '/((?!api/|admin|login|debug).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy
          },
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ],
      },
    ];
  },

  // Turbopack configuration (using correct property)
  turbopack: {
    // Turbopack configuration can be added here if needed
  },
};

export default nextConfig;
