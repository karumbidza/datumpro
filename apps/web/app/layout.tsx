import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Script from 'next/script';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';
import { ThemeProvider } from '@/components/theme-provider';

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
    'Construction project management software — tasks & timelines, sealed tenders, contractor payments and approvals with a full audit trail. By Grafaid Engineers.',
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

/** GA4 — loads only when NEXT_PUBLIC_GA_ID is set (e.g. G-XXXXXXX in Vercel
 *  env). No ID → zero analytics scripts shipped. */
function Analytics() {
  const id = process.env.NEXT_PUBLIC_GA_ID;
  if (!id) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive" />
      <Script id="ga4" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${id}');`}
      </Script>
    </>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={spaceGrotesk.variable}>
      <body className="min-h-screen">
        <ThemeProvider>
          {children}
          <ServiceWorkerRegister />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
