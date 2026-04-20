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
  // Turbopack configuration (using correct property)
  turbopack: {
    // Turbopack configuration can be added here if needed
  },
};

export default nextConfig;
