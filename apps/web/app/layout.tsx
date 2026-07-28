import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
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
  description: 'Universal project management with remote monitoring & finance. By Grafaid Engineers.',
  applicationName: 'DatumPro',
  openGraph: {
    title: 'DatumPro',
    description: 'Remote project monitoring, approvals, and finance — from one source of truth.',
    siteName: 'DatumPro',
    type: 'website',
    images: ['/icon-512.png'],
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
  return (
    <html lang="en" suppressHydrationWarning className={spaceGrotesk.variable}>
      <body className="min-h-screen">
        <ThemeProvider>
          {children}
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
