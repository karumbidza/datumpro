import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://datumpro.app';

/** Served at /sitemap.xml — only the public, indexable pages. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/enterprise`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE}/security`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/sign-in`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
