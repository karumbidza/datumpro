import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ServiceWorkerRegister } from '@/components/pwa/sw-register';

export const metadata: Metadata = {
  title: 'DatumPro',
  description: 'Universal project management with remote monitoring & finance. By Grafaid Engineers.',
  applicationName: 'DatumPro',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'DatumPro', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
