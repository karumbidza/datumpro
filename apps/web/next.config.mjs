/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source; let Next transpile it.
  transpilePackages: ['@datumpro/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
