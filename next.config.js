/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['child_process', 'fs'],
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.node$/,
      use: 'raw-loader',
    });
    
    // Copy ipatool binary khi build
    if (!config.plugins) {
      config.plugins = [];
    }
    
    config.plugins.push({
      apply: (compiler) => {
        compiler.hooks.afterEmit.tapAsync('CopyIpatool', (compilation, callback) => {
          const fs = require('fs');
          const path = require('path');
          
          const source = path.join(__dirname, 'public', 'bin', 'ipatool');
          const destination = path.join(__dirname, '.next', 'server', 'bin', 'ipatool');
          
          // Tạo thư mục nếu chưa tồn tại
          if (!fs.existsSync(path.dirname(destination))) {
            fs.mkdirSync(path.dirname(destination), { recursive: true });
          }
          
          // Copy file
          fs.copyFileSync(source, destination);
          
          // Cấp quyền thực thi
          fs.chmodSync(destination, '755');
          
          callback();
        });
      }
    });
    
    return config;
  },
};

module.exports = nextConfig;