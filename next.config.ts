import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
    ],
  },
  // Turbopack is enabled by default in Next.js 15
  experimental: {
    turbo: {
      // Turbopack configuration can be added here if needed
    },
  },
};

export default nextConfig;
