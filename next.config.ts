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

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,

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
    ],
  },

  // Security headers
  async headers() {
    return [
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
