import type { NextConfig } from "next";

// Content Security Policy.
// Notes on why each non-trivial source is allowed:
// - script-src 'unsafe-inline'/'unsafe-eval': Next.js App Router injects inline
//   bootstrap scripts, and `next dev` relies on eval for HMR. This is an
//   intentionally permissive baseline — see HARDENING.md for nonce-based hardening.
// - style-src 'unsafe-inline': Next and react-hot-toast emit inline styles.
//   Fonts are self-hosted via next/font, so no fonts.gstatic.com is needed.
// - img-src https: (YouTube thumbnails i.ytimg.com + S3); media-src https:
//   (incompetech.com royalty-free audio + S3); frame-src for YouTube embeds.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  // GA4 needs googletagmanager.com (loader) + google-analytics.com (events).
  // Without these, the gtag <script> is blocked → 0 events ever reach GA4.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // connect-src https: already covers google-analytics.com/g/collect, but
  // listing the GA hostnames explicitly makes the dependency obvious.
  "connect-src 'self' https: https://www.google-analytics.com https://*.analytics.google.com",
  "media-src 'self' blob: https:",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
  "upgrade-insecure-requests",
].join('; ');

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
  },

  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
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
