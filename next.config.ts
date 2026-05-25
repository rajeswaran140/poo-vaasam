import type { NextConfig } from "next";

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
    ],
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
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
