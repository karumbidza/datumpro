import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://datumpro.app';

/** Served at /robots.txt. The app behind sign-in is noindex by nature (auth
 *  redirects), but keep crawlers out of API + auth plumbing explicitly. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/', '/invite/', '/reset-password', '/mfa'],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
