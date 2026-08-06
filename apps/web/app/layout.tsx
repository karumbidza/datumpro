import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { ThemeProvider } from '@/components/theme-provider';
import { ConsentAnalytics } from '@/components/consent/analytics';
import { CookieConsent } from '@/components/consent/cookie-consent';

// Distinctive display face for headings (sign-in and marketing surfaces). Body
// stays on the app's system --font-sans; this only drives `font-display`.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: { default: 'DatumPro', template: '%s · DatumPro' },
  description:
    'Construction project management software — tasks & timelines, sealed tenders, contractor payments and approvals with a full audit trail. By Quillstone Digital.',
  applicationName: 'DatumPro',
  openGraph: {
    title: 'DatumPro',
    description:
      'Construction project management — tasks & timelines, sealed tenders, contractor payments with a full audit trail.',
    siteName: 'DatumPro',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'DatumPro — construction project management' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DatumPro',
    description:
      'Construction project management — tasks & timelines, sealed tenders, contractor payments with a full audit trail.',
    images: ['/og.png'],
  },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'DatumPro', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/logo-mark.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // GA4 id is public (NEXT_PUBLIC_*); the scripts themselves load only after the
  // visitor accepts analytics cookies — see ConsentAnalytics. No id → nothing.
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  return (
    <html lang="en" suppressHydrationWarning className={spaceGrotesk.variable}>
      <body className="min-h-screen">
        <ThemeProvider>
          {children}
          <ServiceWorkerRegister />
        </ThemeProvider>
        <CookieConsent />
        <ConsentAnalytics gaId={gaId} />
      </body>
    </html>
  );
}
