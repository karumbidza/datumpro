/** @type {import('next').NextConfig} */

// Security response headers applied to every route (assessment finding F3). CSP
// is Report-Only for now so it can't break the app while the allow-list is
// confirmed against production (Supabase, plus GA/Sentry when their env vars are
// set); flip `Content-Security-Policy-Report-Only` → `Content-Security-Policy`
// once the browser console shows no violations.
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    return '';
  }
})();
const supabaseWs = supabaseHost.replace(/^https/, 'wss');

const csp = [
  "default-src 'self'",
  // next/script inlines a small bootstrap; 'unsafe-inline' covers it and the
  // GA/GTM snippet. Tighten to nonces later if desired.
  "script-src 'self' 'unsafe-inline' https://*.googletagmanager.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseHost} ${supabaseWs} https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.ingest.sentry.io`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
]
  .join('; ')
  .replace(/\s+/g, ' ')
  .trim();

const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), browsing-topics=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript source; let Next transpile it.
  transpilePackages: ['@datumpro/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
