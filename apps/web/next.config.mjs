/** @type {import('next').NextConfig} */

// Security response headers applied to every route (assessment finding F3). The
// Content-Security-Policy is now ENFORCED (previously Report-Only). The allow-list
// was confirmed against what the app actually loads:
//   • fonts        → self-hosted by next/font/google (no gstatic)          → 'self'
//   • scripts      → GA4 (googletagmanager) + inline GA/JSON-LD            → 'unsafe-inline' + gtm
//   • styles       → Tailwind + inline style attributes                    → 'unsafe-inline'
//   • images       → Supabase Storage (https) + blob/data previews         → https: data: blob:
//   • media        → chat audio/video: blob previews + Supabase playback   → https: blob:
//   • connect      → Supabase REST/Realtime, GA, Sentry (any region)       → see connectSrc
// Development adds 'unsafe-eval' (webpack/turbopack HMR uses eval) and ws: (the
// HMR socket) so `next dev` keeps working under the same headers.
const isDev = process.env.NODE_ENV !== 'production';

const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    return '';
  }
})();
const supabaseWs = supabaseHost.replace(/^https/, 'wss');

const scriptSrc = [
  "'self'",
  // next/script inlines the GA bootstrap, and page.tsx inlines a JSON-LD block;
  // 'unsafe-inline' covers both. Tighten to nonces later if desired.
  "'unsafe-inline'",
  'https://*.googletagmanager.com',
  'https://va.vercel-scripts.com',
  ...(isDev ? ["'unsafe-eval'"] : []),
];

const connectSrc = [
  "'self'",
  supabaseHost,
  supabaseWs,
  'https://*.google-analytics.com',
  'https://*.analytics.google.com',
  'https://*.googletagmanager.com',
  // Sentry store endpoint — host comes from the DSN and may be any region
  // (o*.ingest.sentry.io or o*.ingest.us.sentry.io), so allow the whole zone.
  'https://*.sentry.io',
  ...(isDev ? ['ws:'] : []),
];

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // Chat records audio/video to blob: URLs for local preview and streams stored
  // media over https; without this, default-src 'self' would block both.
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  `connect-src ${connectSrc.join(' ')}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // Only in production: locally, Supabase may be plain http on 127.0.0.1 and
  // upgrading it to https would break the dev connection.
  ...(isDev ? [] : ['upgrade-insecure-requests']),
]
  .filter(Boolean)
  .join('; ')
  .replace(/\s+/g, ' ')
  .trim();

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
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
