import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  // Enable standalone output for Docker
  output: 'standalone',
  // Optimize for production
  compress: true,
  poweredByHeader: false,
  // Increase server timeout for long-running processing
  serverExternalPackages: ['bull', 'minio', 'pg'],
};

export default nextConfig;
