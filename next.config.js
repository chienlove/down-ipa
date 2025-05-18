/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['child_process', 'fs'],
  },
  webpack: (config) => {
    // Thêm rule để xử lý binary files nếu cần
    config.module.rules.push({
      test: /\.(bin|node)$/,
      use: {
        loader: 'raw-loader',
      },
    });
    return config;
  },
};

module.exports = nextConfig;