/** @type {import('next').NextConfig} */
const nextConfig = {
  // =============================================
  // 1. CẤU HÌNH CƠ BẢN
  // =============================================
  reactStrictMode: true,
  output: 'standalone', // Tối ưu cho môi trường serverless

  // =============================================
  // 2. CẤU HÌNH QUAN TRỌNG CHO IPATOOL
  // =============================================
  experimental: {
    // Cho phép sử dụng các package hệ thống
    serverComponentsExternalPackages: [
      'child_process',
      'fs',
      'os',
      'path',
      'util'
    ],
    
    // Bật tính năng mới cần thiết
    optimizeServerReact: true,
    serverActions: true,
  },

  // =============================================
  // 3. CẤU HÌNH WEBPACK ĐẶC BIỆT
  // =============================================
  webpack: (config, { isServer }) => {
    // Rule xử lý binary files (ipatool)
    config.module.rules.push({
      test: /\.(bin|node)$/,
      use: {
        loader: 'raw-loader',
      },
    });

    // Bỏ qua cảnh báo về các package native
    config.resolve.fallback = { 
      fs: false,
      child_process: false,
      net: false,
      tls: false,
    };

    // Copy file binary sang thư mục build
    if (isServer) {
      config.plugins.push({
        apply: (compiler) => {
          compiler.hooks.afterEmit.tapPromise('CopyIpatool', async (compilation) => {
            const fs = require('fs/promises');
            const path = require('path');
            
            const source = path.join(__dirname, 'public', 'bin', 'ipatool');
            const destination = path.join(__dirname, '.next', 'server', 'bin', 'ipatool');
            
            try {
              await fs.mkdir(path.dirname(destination), { recursive: true });
              await fs.copyFile(source, destination);
              await fs.chmod(destination, 0o755); // cấp quyền thực thi
              console.log('✅ Copied ipatool binary to build directory');
            } catch (err) {
              console.error('❌ Failed to copy ipatool:', err);
            }
          });
        }
      });
    }

    return config;
  },

  // =============================================
  // 4. CẤU HÌNH HEADERS (NẾU CẦN)
  // =============================================
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

  // =============================================
  // 5. TẮT COMPRESSION (NẾU IPATOOL YÊU CẦU)
  // =============================================
  compress: false,
};

module.exports = nextConfig;