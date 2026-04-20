import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactStrictMode: true,
  eslint: {
    // Disable ESLint during production build
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Disable type checking during production build
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.amazonaws.com',
      },
    ],
  },
  // Turbopack configuration (using correct property)
  turbopack: {
    // Turbopack configuration can be added here if needed
  },
};

export default nextConfig;
