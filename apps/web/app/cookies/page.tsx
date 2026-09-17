import Link from 'next/link';
import type { Metadata } from 'next';
import { DraftNotice } from '@/components/legal/draft-notice';
import { MarketingShell } from '@/components/marketing/chrome';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Cookie Policy',
  description:
    'How DatumPro uses cookies and similar technologies, the categories we set, and how to manage your choices.',
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-24 text-2xl font-medium tracking-[-0.015em] text-zinc-900 dark:text-zinc-50">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-[65ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</p>;
}

const COOKIES = [
  {
    name: 'Essential',
    examples: 'Sign-in session, active organisation, security/CSRF and load-balancing cookies.',
    set: 'Always on',
    purpose: 'Required to run the Service — keep you signed in and protect requests. The Service cannot function without them, so they are not subject to consent.',
  },
  {
    name: 'Preferences',
    examples: 'Theme, remembered cookie choice.',
    set: 'Always on',
    purpose: 'Remember choices you make (such as light/dark theme and your cookie decision) so the site behaves the way you expect.',
  },
  {
    name: 'Analytics',
    examples: 'Google Analytics (_ga, _ga_*).',
    set: 'Off by default — only after you Accept',
    purpose: 'Help us understand aggregate usage to improve the product. These load only if you select “Accept” in the cookie banner, and never before.',
  },
];

export default function CookiesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <DraftNotice />

        <h1 className="text-4xl font-medium leading-[1.08] tracking-[-0.02em] sm:text-5xl">Cookie Policy.</h1>
        <p className="mt-4 text-sm tabular-nums text-zinc-600 dark:text-zinc-400">Last updated: {LEGAL.lastUpdated}</p>

        <P>
          This Cookie Policy explains how {LEGAL.legalEntity} — which provides {LEGAL.product} through its
          {' '}{LEGAL.department} division (“{LEGAL.product}”, “we”, “us”) — uses cookies and similar
          technologies on the {LEGAL.product} website and application (the “Service”). It should be read
          alongside our <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </P>

        <H2 id="what">1. What cookies are</H2>
        <P>
          Cookies are small text files a website stores on your device. We also use closely related
          technologies such as browser <em>localStorage</em> and session storage. Together we refer to
          them as “cookies” in this policy. They can be set by us (first-party) or by a provider we use
          (third-party, such as our analytics provider).
        </P>

        <H2 id="categories">2. Categories we use</H2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="py-2 pr-4 font-semibold">Category</th>
                <th className="py-2 pr-4 font-semibold">Examples</th>
                <th className="py-2 pr-4 font-semibold">When set</th>
                <th className="py-2 font-semibold">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {COOKIES.map((c) => (
                <tr key={c.name} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-4 font-medium text-zinc-800 dark:text-zinc-200">{c.name}</td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300">{c.examples}</td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-300">{c.set}</td>
                  <td className="py-2 text-zinc-600 dark:text-zinc-300">{c.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H2 id="consent">3. Your choices &amp; consent</H2>
        <P>
          Analytics cookies are <strong>off by default</strong>. The first time you visit, our cookie
          banner lets you <strong>Accept</strong> or <strong>Decline</strong> analytics. If you decline,
          no analytics cookies are set and no analytics scripts are loaded. Essential and preference
          cookies are always on because the Service cannot run without them.
        </P>
        <P>
          You can change your decision at any time using <strong>“Manage cookies”</strong> in the site
          footer. You can also block or delete cookies through your browser settings, though essential
          cookies are needed for sign-in and core features to work.
        </P>

        <H2 id="thirdparty">4. Third-party cookies</H2>
        <P>
          When you consent to analytics, Google Analytics may set cookies to measure aggregate usage.
          We configure analytics to load only after consent. For details of that provider’s processing,
          see our <Link href="/privacy#sharing" className="underline">sub-processors list</Link> in the
          Privacy Policy.
        </P>

        <H2 id="changes">5. Changes to this policy</H2>
        <P>
          We may update this policy from time to time. We will revise the “Last updated” date above and,
          for material changes, take reasonable steps to notify you.
        </P>

        <H2 id="contact">6. Contact us</H2>
        <P>
          {LEGAL.legalEntity} · Registration {LEGAL.registrationNumber} · {LEGAL.registeredAddress} ·{' '}
          {LEGAL.phone}. Privacy enquiries:{' '}
          <a href={`mailto:${LEGAL.privacyEmail}`} className="underline">{LEGAL.privacyEmail}</a>.
        </P>

        <p className="mt-12 border-t border-zinc-200 pt-8 text-[17px] text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          See also our <Link href="/privacy" className="underline">Privacy Policy</Link> and{' '}
          <Link href="/terms" className="underline">Terms of Service</Link>.
        </p>
      </div>
    </MarketingShell>
  );
}
