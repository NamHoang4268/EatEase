import type { NextConfig } from 'next';
import { loadServerEnvironment } from './src/config/environment';

const environment = loadServerEnvironment();
const distDir = process.env.NEXT_DIST_DIR?.trim() || '.next';

const nextConfig: NextConfig = {
  agentRules: false,
  distDir,
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
