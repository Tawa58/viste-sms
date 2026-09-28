import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // Standalone is for Docker / Railway / Render only — breaks Vercel serverless APIs
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
  reactStrictMode: true,
  serverExternalPackages: ['firebase-admin'],
  // Keep HTML fresh after deploys; hashed /_next/static assets stay immutable by default
  async headers() {
    return [
      {
        source: '/:path((?!_next/static|_next/image|favicon.png|icon.png|apple-icon.png).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/download/:file*.apk',
        headers: [
          { key: 'Content-Type', value: 'application/vnd.android.package-archive' },
          { key: 'Content-Disposition', value: 'attachment; filename="Viste-SMS.apk"' },
        ],
      },
    ]
  },
  turbopack: {
    resolveAlias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(rootDir, 'src'),
    }
    return config
  },
}

export default nextConfig
