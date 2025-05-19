/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  
  experimental: {
    serverComponentsExternalPackages: [
      'child_process',
      'fs',
      'os',
      'path',
      'util'
    ],
    optimizeServerReact: true,
  },

  webpack: (config, { isServer }) => {
    // Thêm rule cho binary files
    config.module.rules.push({
      test: /\.(bin|node)$/,
      type: 'asset/resource',
      generator: {
        filename: 'static/bin/[name][ext]'
      }
    });

    // Cấu hình fallback đơn giản hơn
    config.resolve.fallback = { 
      fs: false,
      child_process: false,
      path: false // Không cần path-browserify nếu không dùng ở client side
    };

    // Chỉ xử lý copy file khi ở server side
    if (isServer) {
      const CopyPlugin = require('copy-webpack-plugin');
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: 'public/bin/ipatool',
              to: 'bin/ipatool'
            }
          ]
        })
      );
    }

    return config;
  },

  compress: true,
};

module.exports = nextConfig;