import type { NextConfig } from 'next';
import { loadServerEnvironment } from './src/config/environment';

const environment = loadServerEnvironment();

const nextConfig: NextConfig = {
  agentRules: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${environment.API_INTERNAL_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
