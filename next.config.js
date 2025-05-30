/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Remove standalone for now to avoid complexity
  // output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['child_process', 'fs'],
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false }
    return config
  }
}

module.exports = nextConfig