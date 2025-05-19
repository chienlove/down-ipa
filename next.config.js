/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  
  // Bỏ cấu hình experimental.serverActions vì đã được tích hợp sẵn từ Next.js 14
  experimental: {
    serverComponentsExternalPackages: [
      'child_process',
      'fs',
      'os',
      'path',
      'util'
    ],
    optimizeServerReact: true,
    // serverActions: true, // Đã bỏ vì không cần thiết
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

    // Cấu hình fallback
    config.resolve.fallback = { 
      fs: false,
      child_process: false,
      net: false,
      tls: false,
      path: require.resolve('path-browserify')
    };

    // Copy file binary khi build
    if (isServer) {
      const { CopyPlugin } = require('webpack').CopyPlugin;
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: path.join(__dirname, 'public/bin/ipatool'),
              to: path.join(__dirname, '.next/server/bin/ipatool'),
              force: true
            }
          ]
        })
      );
    }

    return config;
  },

  async headers() {
    return [
      {
        source: '/api/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST' },
        ],
      },
    ];
  },

  // Bật compression nếu không có yêu cầu đặc biệt từ ipatool
  compress: true,
};

module.exports = nextConfig;