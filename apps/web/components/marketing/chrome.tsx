import Link from 'next/link';
import { ManageCookiesLink } from '@/components/consent/manage-cookies-link';
import { newsreader } from './font';

/* Shared chrome for the public marketing/legal surfaces (landing, enterprise,
   security, terms, privacy). Same restrained document language as the landing:
   white ground, zinc ink, hairlines, brand blue on the single primary CTA. */

export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:focus-visible:outline-brand-400';

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className={`flex items-center gap-2.5 ${focusRing}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="h-7 w-7 rounded-md" />
          <span className="text-lg font-medium tracking-tight">DatumPro</span>
        </Link>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="Main">
          {(
            [
              ['The work', '/#work'],
              ['The money', '/#money'],
              ['The record', '/#record'],
              ['FAQ', '/#faq'],
            ] as [string, string][]
          ).map(([label, href]) => (
            <Link key={label} href={href} className={`text-[15px] text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 ${focusRing}`}>
              {label}
            </Link>
          ))}
          <Link href="/enterprise" className={`text-[15px] text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 ${focusRing}`}>
            Enterprise
          </Link>
        </nav>
        <div className="flex items-center gap-5">
          <Link href="/sign-in" className={`hidden text-[15px] text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 sm:inline-block ${focusRing}`}>
            Sign in
          </Link>
          <Link
            href="/#demo"
            className={`inline-flex h-10 items-center justify-center rounded-lg bg-brand-600 px-4 text-[15px] font-medium text-white transition-colors hover:bg-brand-700 ${focusRing}`}
          >
            Request a demo
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-10 text-sm text-zinc-600 dark:text-zinc-400 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="h-6 w-6 rounded-md" />
          <span className="font-medium text-zinc-900 dark:text-zinc-50">DatumPro</span>
          <span>· © 2026 · by Quillstone Digital</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Link href="/enterprise" className={`hover:text-zinc-900 dark:hover:text-zinc-50 ${focusRing}`}>
            Enterprise
          </Link>
          <Link href="/security" className={`hover:text-zinc-900 dark:hover:text-zinc-50 ${focusRing}`}>
            Security
          </Link>
          <Link href="/terms" className={`hover:text-zinc-900 dark:hover:text-zinc-50 ${focusRing}`}>
            Terms
          </Link>
          <Link href="/privacy" className={`hover:text-zinc-900 dark:hover:text-zinc-50 ${focusRing}`}>
            Privacy
          </Link>
          <ManageCookiesLink className={`hover:text-zinc-900 dark:hover:text-zinc-50 ${focusRing}`} />
        </div>
      </div>
    </footer>
  );
}

/** Full-page wrapper for marketing subpages: serif voice, nav and footer. */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <main className={`landing ${newsreader.variable} bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50`}>
      <MarketingNav />
      {children}
      <MarketingFooter />
    </main>
  );
}
