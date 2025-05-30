/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['child_process', 'fs'],
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, path: false }
    return config
  },
  // Ensure Railway can find the app
  serverRuntimeConfig: {
    port: process.env.PORT || 3000,
  },
  publicRuntimeConfig: {
    port: process.env.PORT || 3000,
  }
}

module.exports = nextConfig