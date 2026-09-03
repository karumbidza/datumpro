import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { ManageCookiesLink } from '@/components/consent/manage-cookies-link';
import { SubmitButton } from '@/components/ui/submit-button';
import { requestDemo } from './request-demo-action';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://datumpro.app';

/* ── Inline icon set ─────────────────────────────────────────────────────────
   The app ships no icon library, so we inline the handful we use (lucide path
   data, MIT). One component keyed by name keeps the markup readable. */
const ICON_PATHS: Record<string, string> = {
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  'badge-check':
    '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  shield:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>',
  scroll:
    '<path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>',
  building:
    '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  camera:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
};

function Icon({ name, className = '' }: { name: keyof typeof ICON_PATHS | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] ?? '' }}
    />
  );
}

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: { absolute: 'DatumPro — Construction Project Management Software' },
  description:
    'Construction project management software that runs delivery, tendering and payments on a full audit trail — tasks & timelines, sealed tenders, contractor payments and approvals. Built for the field, from site to boardroom. Request a demo.',
  keywords: [
    'construction project management software',
    'project management software',
    'field project management',
    'tender management software',
    'contractor payment software',
    'construction scheduling software',
    'project management Zimbabwe',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: 'DatumPro — Construction Project Management Software',
    description:
      'Run delivery, sealed tendering and contractor payments on one system with a full audit trail. Built for the field, from site to boardroom. Request a demo.',
    url: '/',
    siteName: 'DatumPro',
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'DatumPro — construction project management, field to boardroom' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DatumPro — Construction Project Management Software',
    description: 'Run delivery, sealed tendering and contractor payments on one system with a full audit trail. Request a demo.',
    images: ['/og.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-snippet': -1, 'max-image-preview': 'large', 'max-video-preview': -1 },
  },
};

/** FAQ content — rendered on the page AND emitted as FAQPage JSON-LD, from the
 *  same source so they can never disagree. */
const FAQS: { q: string; a: string }[] = [
  {
    q: 'How is DatumPro different from a general project tool?',
    a: 'General task tools have no construction logic — no critical-path dependencies, no bill-of-quantities, no sealed subcontractor tendering, and no photo-evidenced sign-off. DatumPro is built around exactly those, with a phone-first experience your site teams can pick up in minutes rather than a tool only the office uses.',
  },
  {
    q: 'How does sealed tendering and contractor payment work?',
    a: 'When you put a task out to tender, bids stay sealed until the deadline, so nobody — inside or outside — sees a number early. After the award, payments are tied to milestones that need photo evidence and approval sign-off before anything is released, and every step lands in the audit log.',
  },
  {
    q: 'Do subcontractors need a paid licence or an app download?',
    a: 'No. Contractors and suppliers join from a single phone-friendly invite, sign in with a 6-digit email code instead of a password, and only ever see their own tasks and money — no seat to buy, nothing to install.',
  },
  {
    q: 'How do I get started?',
    a: 'Onboarding is managed by our team, not a self-serve signup. Request a demo and a specialist will be in touch within 8 hours to understand your projects, set up your organisation, and help bring your existing schedule and contacts across.',
  },
];

function JsonLd() {
  const data = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'DatumPro',
      url: BASE,
      logo: `${BASE}/icon-512.png`,
      description:
        'DatumPro is a product of Quillstone Capital Private Limited, built by its Quillstone Digital division — construction project management software that runs delivery, tendering and payments on a full audit trail.',
      parentOrganization: { '@type': 'Organization', name: 'Quillstone Capital Private Limited' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'DatumPro',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android, iOS',
      url: BASE,
      image: `${BASE}/og.png`,
      description:
        'Construction project management software: tasks with dependencies, planned-vs-actual timelines, sealed tendering, contractor payments and approvals with an audit trail.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ];
  return (
    <script
      type="application/ld+json"
      // JSON-LD must ship as a literal script tag; content is our own constants.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

/** Public landing. Signed-in users skip straight to their dashboard. Onboarding
 *  is admin-managed — no self-serve signup — so every primary CTA opens the
 *  "Request a demo" form. Product visuals are drawn with the app's own recipes
 *  (no screenshots) so the marketing page can't drift from the product. */
export default async function HomePage({ searchParams }: { searchParams?: Promise<{ demo?: string }> }) {
  const user = await getAuthUser();
  if (user) redirect('/dashboard');

  const demo = (await searchParams)?.demo;

  return (
    <main className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-white">
      <JsonLd />
      <TopNav />
      <Hero />
      <ProductPreview />
      <ValuePillars />
      <FieldBand />
      <Governance />
      <DemoRequest status={demo} />
      <Faq />
      <Footer />
    </main>
  );
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */

function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200/70 bg-white/80 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="h-8 w-8 rounded-md" />
          <span className="font-display text-base font-bold tracking-tight">DatumPro</span>
        </Link>
        <nav className="hidden items-center gap-1 lg:flex">
          {[
            ['Product', '#product'],
            ['In the field', '#field'],
            ['Security', '#governance'],
            ['FAQ', '#faq'],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              {label}
            </a>
          ))}
          <Link
            href="/enterprise"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            Enterprise
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="hidden text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white sm:inline-block">
            Sign in
          </Link>
          <a
            href="#demo"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
          >
            Request a demo
          </a>
        </div>
      </div>
    </header>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  const assurances: [string, string][] = [
    ['clock', 'Response within 8 hours'],
    ['badge-check', 'Dedicated specialist onboarding'],
    ['shield', 'No credit card required'],
  ];
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(37,99,235,.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(37,99,235,.07) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 55%, transparent 100%)',
        }}
      />
      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pb-6 pt-16 text-center sm:px-6 sm:pt-20 lg:px-8">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-300">
            Construction project management · field to boardroom
          </span>
        </div>
        <h1 className="font-display max-w-3xl text-4xl font-bold leading-[1.08] tracking-[-0.02em] sm:text-5xl" style={{ textWrap: 'balance' }}>
          Project management that runs <span className="text-brand-500">the work</span>, the money, and the paper trail.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base text-zinc-500 dark:text-zinc-400 sm:text-lg">
          DatumPro tracks every task against the plan, runs sealed subcontractor tenders, and moves milestone payments
          with a full audit trail — so nothing lives in a notebook, a group chat, or someone&rsquo;s head.
        </p>
        <div className="mt-8 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
          <a
            href="#demo"
            className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-brand-500 px-7 text-base font-semibold text-white shadow-sm transition hover:bg-brand-600 sm:w-auto"
          >
            Request a demo <Icon name="arrow" className="h-4 w-4" />
          </a>
          <a
            href="#product"
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-6 text-base font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:w-auto"
          >
            See it in action
          </a>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
          {assurances.map(([icon, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <Icon name={icon} className="h-4 w-4 text-green-600 dark:text-green-500" /> {label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Product preview (browser-framed CSS mock) ───────────────────────────── */

function ProductPreview() {
  const rows: {
    title: string;
    who: string;
    chip: string;
    chipCls: string;
    bar: { left: string; width: string; cls: string }[];
    note?: { text: string; cls: string; at: string };
  }[] = [
    {
      title: 'Excavation & footings',
      who: 'Rudo C.',
      chip: 'Done',
      chipCls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400',
      bar: [{ left: '2%', width: '26%', cls: 'bg-green-600' }],
      note: { text: '✓ 2d early', cls: 'text-green-700 dark:text-green-400', at: '30%' },
    },
    {
      title: 'Slab reinforcement',
      who: 'Rudo C.',
      chip: 'Active',
      chipCls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
      bar: [
        { left: '20%', width: '38%', cls: 'bg-zinc-300 dark:bg-zinc-700' },
        { left: '20%', width: '24%', cls: 'bg-brand-500' },
      ],
      note: { text: '3d left', cls: 'text-zinc-500 dark:text-zinc-400', at: '60%' },
    },
    {
      title: 'Electrical first fix',
      who: 'Moyo Electrical',
      chip: 'Blocked',
      chipCls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
      bar: [
        { left: '34%', width: '34%', cls: 'bg-zinc-300 dark:bg-zinc-700' },
        { left: '34%', width: '12%', cls: 'bg-amber-500' },
      ],
      note: { text: 'blocked — cable delivery', cls: 'text-amber-700 dark:text-amber-400', at: '70%' },
    },
    {
      title: 'Blockwork ground floor',
      who: 'Tender · 3 sealed bids',
      chip: 'Tender',
      chipCls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
      bar: [{ left: '52%', width: '30%', cls: 'bg-zinc-200 dark:bg-zinc-800' }],
      note: { text: 'award opens Fri', cls: 'text-zinc-500 dark:text-zinc-400', at: '84%' },
    },
  ];

  return (
    <section id="product" className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-20 lg:px-8">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40">
        {/* Browser chrome */}
        <div className="flex items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex gap-1.5">
            <i className="h-3 w-3 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <i className="h-3 w-3 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <i className="h-3 w-3 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </span>
          <span className="mx-auto flex max-w-md flex-1 items-center gap-1.5 truncate rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-left font-mono text-[11px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            <Icon name="lock" className="h-3 w-3 shrink-0 text-green-600 dark:text-green-500" />
            <span className="truncate text-zinc-700 dark:text-zinc-200">datumpro.app/projects/riverside-office-block</span>
          </span>
          <span className="hidden shrink-0 rounded bg-brand-50 px-2 py-0.5 font-mono text-[10px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400 sm:inline">
            Live audit sync
          </span>
        </div>

        <div className="p-4 sm:p-6">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Progress vs plan', value: '62%', sub: 'target 58% — ahead', tone: 'text-green-700 dark:text-green-400' },
              { label: 'Active blockers', value: '1', sub: 'cable delivery', tone: 'text-amber-700 dark:text-amber-400' },
              { label: 'Budget committed', value: '$311k', sub: 'of $480k', tone: 'text-zinc-500 dark:text-zinc-400' },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-zinc-200 p-3 text-left dark:border-zinc-800">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{k.label}</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums sm:text-2xl">{k.value}</p>
                <p className={`text-[11px] ${k.tone}`}>{k.sub}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <span className="text-xs font-medium">Timeline — planned vs actual</span>
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Week 31</span>
            </div>
            <div className="space-y-1 p-3">
              {rows.map((r) => (
                <div key={r.title} className="flex items-center gap-3">
                  <div className="w-36 shrink-0 text-left sm:w-44">
                    <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                      <span className="truncate">{r.title}</span>
                      <span className={`shrink-0 rounded px-1 py-px text-[9px] font-medium ${r.chipCls}`}>{r.chip}</span>
                    </p>
                    <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{r.who}</p>
                  </div>
                  <div className="relative h-8 flex-1">
                    <span className="absolute inset-y-0 left-[44%] w-px bg-brand-500/40" />
                    {r.bar.map((b, i) => (
                      <span key={i} className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm ${b.cls}`} style={{ left: b.left, width: b.width }} />
                    ))}
                    {r.note && (
                      <span
                        className={`absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium ${r.note.cls}`}
                        style={{ left: r.note.at }}
                      >
                        {r.note.text}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Working-view tabs */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="h-2 w-2 rounded-full bg-green-500" /> Live portfolio sync
              </span>
              <span className="hidden text-zinc-400 sm:inline">·</span>
              <span className="hidden text-zinc-500 dark:text-zinc-400 sm:inline">3 active sites · 1 blocker flagged</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-600 dark:text-brand-400">Timeline</span>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Approvals · 2</span>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">BOQ &amp; variations</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Value pillars ───────────────────────────────────────────────────────── */

function ValuePillars() {
  return (
    <section className="border-y border-zinc-200 bg-zinc-50 py-16 dark:border-zinc-800 dark:bg-zinc-900/40 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 sm:px-6 lg:px-8">
        <div className="mb-12 max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">The whole job, one system</p>
          <h2 className="font-display mt-2 text-3xl font-bold tracking-[-0.02em]" style={{ textWrap: 'balance' }}>
            Delivery, tendering, and money — connected
          </h2>
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
            Each task carries its schedule, its contract, and its payments. When something slips, you see it the day it
            slips — not at month-end.
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-3">
          <PillarCard
            eyebrow="Field execution"
            title="Delivery you can defend"
            body="Tasks with dependencies, a live planned-vs-actual timeline, blockers logged with a reason, and SLA states that escalate before the deadline — not after."
            bullets={['Milestone cascade recalculates automatically', 'Blockers carry a reason and an owner', 'Gantt export for board reporting']}
            cta="Explore timeline intelligence"
            visual={
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full w-4/5 rounded-full bg-green-600" /></div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full w-3/5 rounded-full bg-brand-500" /></div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full w-1/4 rounded-full bg-amber-500" /></div>
              </div>
            }
          />
          <PillarCard
            eyebrow="Procurement integrity"
            title="Tenders without the drama"
            body="Put a task out to sealed bids. Contractors price their own plan, nobody sees anyone else's number until the deadline, and the award writes the contract straight into the task."
            bullets={['Bids stay sealed until the deadline', 'Side-by-side rate comparison on award', 'Contract created the moment you award']}
            cta="Review sealed tendering"
            visual={
              <div className="space-y-1.5">
                {[
                  { who: 'Moyo Electrical', amt: '••••• (sealed)', win: false },
                  { who: 'PowerGrid Co.', amt: '••••• (sealed)', win: false },
                  { who: 'Amp Solutions', amt: '$8,400 · awarded', win: true },
                ].map((b) => (
                  <div
                    key={b.who}
                    className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] ${
                      b.win
                        ? 'border-brand-500/50 bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400'
                        : 'border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    <span>{b.who}</span>
                    <span className="tabular-nums">{b.amt}</span>
                  </div>
                ))}
              </div>
            }
          />
          <PillarCard
            eyebrow="Fiscal control"
            title="Money with a paper trail"
            body="Budget vs committed vs paid, per task and per project. Contractors submit claims with photo evidence, approvers sign off, and proof of payment attaches to the record."
            bullets={['Photo-evidenced claims from the field', 'Two-person approval on release', 'Retention & variations tracked natively']}
            cta="Inspect payment governance"
            visual={
              <div>
                <div className="mb-2 flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span>Paid $250k</span>
                  <span>Committed $86k</span>
                  <span>Budget $480k</span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <span className="bg-brand-500" style={{ width: '52%' }} />
                  <span className="bg-brand-300 dark:bg-brand-500/40" style={{ width: '18%' }} />
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                  <Icon name="badge-check" className="h-3.5 w-3.5" /> Two-person approval passed
                </p>
              </div>
            }
          />
        </div>

        {/* Programme strip */}
        <ProgrammeStrip />
      </div>
    </section>
  );
}

function PillarCard({
  eyebrow,
  title,
  body,
  bullets,
  cta,
  visual,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  cta: string;
  visual: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <div className="mb-4 rounded-lg border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-800/60 dark:bg-zinc-900/40">{visual}</div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">{eyebrow}</p>
        <h3 className="mt-1 text-lg font-semibold">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
        <ul className="mt-4 space-y-2 text-sm">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <Icon name="badge-check" className="mt-0.5 h-4 w-4 flex-none text-green-600 dark:text-green-500" />
              <span className="text-zinc-700 dark:text-zinc-200">{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-5 border-t border-zinc-100 pt-4 text-xs font-medium text-brand-600 dark:border-zinc-800 dark:text-brand-400">{cta} →</p>
    </div>
  );
}

function ProgrammeStrip() {
  const rows = [
    { name: 'Substructure', who: 'Civils crew', left: '0%', width: '22%', cls: 'bg-green-600' },
    { name: 'Superstructure — Block A', who: 'In progress', left: '18%', width: '34%', cls: 'bg-brand-500' },
    { name: 'Envelope & roofing', who: 'Depends on frame', left: '48%', width: '26%', cls: 'bg-zinc-300 dark:bg-zinc-700' },
    { name: 'MEP first fix', who: 'Tender open', left: '58%', width: '30%', cls: 'bg-zinc-200 dark:bg-zinc-800' },
  ];
  return (
    <div className="mt-8 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">Live programme &amp; critical path</span>
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-green-700 dark:bg-green-500/15 dark:text-green-400">
              From site
            </span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Hillside Apartments — Block A · dependencies drive the dates</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zinc-100 px-2.5 py-1 font-mono text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Baseline: Aug 22</span>
          <span className="rounded-md bg-brand-500 px-2.5 py-1 font-mono text-[11px] font-medium text-white">Auto-schedule on</span>
        </div>
      </div>
      <div className="space-y-1.5 p-4">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3">
            <div className="w-40 shrink-0 text-left sm:w-52">
              <p className="truncate text-xs font-medium">{r.name}</p>
              <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">{r.who}</p>
            </div>
            <div className="relative h-6 flex-1 rounded bg-zinc-50 dark:bg-zinc-900/60">
              <span className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm ${r.cls}`} style={{ left: r.left, width: r.width }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Field band (dark in both themes) ────────────────────────────────────── */

function FieldBand() {
  const features: [string, string, string][] = [
    ['send', 'Contractors join in one screen', 'An invite sets up their profile — phone-first, WhatsApp-friendly — and they only ever see their own tasks and money.'],
    ['hash', 'Sign-in is a 6-digit code', 'No passwords to forget on site. The app signs in with a one-time code from email, in seconds.'],
    ['camera', 'Progress is proof, not promises', 'Milestones need a geotagged, timestamped photo before they can be marked done — so the claim comes with its evidence.'],
  ];
  return (
    <section id="field" className="bg-zinc-950 text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-12 lg:px-8">
        <div className="lg:col-span-7">
          <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1">
            <Icon name="send" className="h-4 w-4 text-brand-400" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-brand-400">Zero manual required</span>
          </div>
          <h2 className="font-display text-3xl font-bold tracking-[-0.02em]" style={{ textWrap: 'balance' }}>
            Built for the field. Your site crews won&rsquo;t need training.
          </h2>
          <p className="mt-3 max-w-xl text-base text-zinc-400">
            Software fails on site when it needs a manual. DatumPro works like the messaging apps your foremen and trades
            already use every day.
          </p>
          <div className="mt-8 space-y-5">
            {features.map(([icon, t, b]) => (
              <div key={t} className="flex items-start gap-4">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-white/10">
                  <Icon name={icon} className="h-5 w-5 text-brand-400" />
                </div>
                <div>
                  <h4 className="font-semibold text-white">{t}</h4>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{b}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Phone mock */}
        <div className="lg:col-span-5">
          <div className="mx-auto w-full max-w-[320px] rounded-[2rem] border border-zinc-800 bg-zinc-900 p-3 shadow-2xl shadow-black/50">
            <div className="mx-auto mb-3 h-4 w-24 rounded-full bg-zinc-800" />
            <div className="rounded-[1.4rem] bg-zinc-950 p-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div>
                  <span className="block font-mono text-[10px] text-zinc-500">Level 2 · Block B</span>
                  <span className="text-sm font-bold">Slab reinforcement</span>
                </div>
                <span className="rounded bg-brand-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-brand-400">Step 7 / 11</span>
              </div>
              <div className="py-3">
                <div className="mb-1.5 flex justify-between font-mono text-[10px] text-zinc-500">
                  <span>Task checklist</span>
                  <span className="font-bold text-green-400">64% done</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800"><div className="h-full w-[64%] rounded-full bg-green-500" /></div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 rounded-lg bg-zinc-900 p-2 text-xs">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-green-500 text-[9px] text-white">✓</span>
                  <span className="text-zinc-500 line-through">Bottom mat rebar layout</span>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-zinc-900 p-2 text-xs">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-green-500 text-[9px] text-white">✓</span>
                  <span className="text-zinc-500 line-through">Chairs &amp; spacers positioned</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-brand-500/10 p-2 text-xs font-semibold text-brand-400">
                  <span className="flex items-center gap-2"><span className="h-4 w-4 rounded border border-brand-400/60" /> Top steel tie-in check</span>
                  <Icon name="camera" className="h-4 w-4" />
                </div>
              </div>
              {/* Geotagged photo placeholder — CSS, not an external asset */}
              <div className="relative mt-3 flex h-24 flex-col justify-end overflow-hidden rounded-lg bg-gradient-to-br from-zinc-700 to-zinc-800 p-2">
                <div className="absolute inset-0 flex items-center justify-center opacity-30">
                  <Icon name="camera" className="h-8 w-8 text-white" />
                </div>
                <div className="relative flex items-center justify-between font-mono text-[10px] text-white/90">
                  <span className="flex items-center gap-1"><Icon name="pin" className="h-3 w-3" /> −17.83, 31.05</span>
                  <span>Today 11:42</span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between rounded-xl bg-zinc-900 p-3">
                <div>
                  <span className="block font-mono text-[10px] text-zinc-500">Milestone claim</span>
                  <span className="text-sm font-bold">$2,150.00</span>
                </div>
                <span className="rounded bg-amber-500/15 px-2 py-1 font-mono text-[10px] font-bold text-amber-400">Awaiting review</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Governance ──────────────────────────────────────────────────────────── */

function Governance() {
  const cards: { icon: string; tag: string; title: string; body: string; href: string }[] = [
    {
      icon: 'shield',
      tag: 'Row-level security',
      title: 'Role-scoped access',
      body: 'PMs, contractors, surveyors and client reps each see exactly their slice — enforced in the database, not just the interface. Contractors never see competing bids or project margins.',
      href: '/security',
    },
    {
      icon: 'scroll',
      tag: 'Verifiable ledger',
      title: 'Every action on the record',
      body: 'Approvals, awards, tender unsealings and payment sign-offs land in a timestamped audit log your client can stand behind — a paper trail by design.',
      href: '/security',
    },
    {
      icon: 'building',
      tag: 'Ready when you scale',
      title: 'Ready for bigger jobs',
      body: 'Two-person approvals, enforced two-factor authentication and verified email domains — the controls a larger organisation needs, ready when you are.',
      href: '/enterprise',
    },
  ];
  return (
    <section id="governance" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">Governance &amp; accountability</p>
        <h2 className="font-display mt-2 text-3xl font-bold tracking-[-0.02em]" style={{ textWrap: 'balance' }}>
          Built for multi-party accountability
        </h2>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
          Contractors, owners and trade specialists work on the same record — without any of them seeing scope or money
          that isn&rsquo;t theirs.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.title}
            href={c.href}
            className="group rounded-xl border border-zinc-200 bg-white p-6 shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-400">
              <Icon name={c.icon} className="h-6 w-6" />
            </div>
            <span className="mb-2 inline-block rounded bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {c.tag}
            </span>
            <h3 className="text-base font-semibold">{c.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{c.body}</p>
            <span className="mt-3 inline-block text-xs font-medium text-brand-600 dark:text-brand-400">Learn more →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── Request a demo ──────────────────────────────────────────────────────── */

const fieldCls =
  'h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/25 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500';

/** Onboarding is admin-managed: prospects request a demo and a specialist
 *  follows up within 8 hours. Posts to the `requestDemo` server action, which
 *  records the intent (shared RPC) and fires a best-effort notification.
 *  ?demo=sent|error drives the state; honeypot `website` drops bots. */
function DemoRequest({ status }: { status?: string }) {
  if (status === 'sent') {
    return (
      <section id="demo" className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6 lg:px-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400">
            <Icon name="badge-check" className="h-6 w-6" />
          </div>
          <h2 className="font-display mt-5 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">Request received</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
            Thanks — a specialist will be in touch within 8 hours to arrange your walkthrough and set up your
            organisation. Keep an eye on your inbox.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="demo" className="border-y border-zinc-200 bg-zinc-50 py-16 dark:border-zinc-800 dark:bg-zinc-900/40 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-10 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 sm:p-8 lg:grid-cols-2 lg:gap-14 lg:p-10">
          {/* Left — value */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">Managed onboarding</p>
            <h2 className="font-display mt-2 text-3xl font-bold tracking-[-0.02em]" style={{ textWrap: 'balance' }}>
              A walkthrough tailored to how you deliver
            </h2>
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
              See DatumPro running against your own kind of work — your subcontractor tiers and approval chains — not a
              generic demo with dummy data.
            </p>
            <ul className="mt-6 space-y-4">
              {([
                ['badge-check', 'Your organisation set up with you', 'A specialist configures your workflows — you don’t start from a blank slate.'],
                ['arrow', 'We help bring your existing plan across', 'Your current schedule, tasks and contractor contacts, imported with you.'],
                ['clock', 'A specialist in touch within 8 hours', 'No long consultancy engagement — you’ll hear from us the same working day.'],
              ] as [string, string, string][]).map(([icon, t, b]) => (
                <li key={t} className="flex items-start gap-3">
                  <Icon name={icon} className="mt-0.5 h-5 w-5 flex-none text-green-600 dark:text-green-500" />
                  <span>
                    <span className="block text-sm font-semibold">{t}</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{b}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Right — form */}
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50 sm:p-6">
            <div className="mb-4">
              <h3 className="font-display text-xl font-bold">Book your live walkthrough</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">We&rsquo;ll reply with a tailored time within 8 hours.</p>
            </div>
            {status === 'error' && (
              <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                Something went wrong — please check your organisation and email and try again.
              </p>
            )}
            <form action={requestDemo} className="space-y-4">
              {/* Honeypot — hidden from humans, catches bots. */}
              <div aria-hidden className="hidden">
                <label>Leave this field empty<input type="text" name="website" tabIndex={-1} autoComplete="off" /></label>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="contactName" className="mb-1 block text-sm font-medium">Full name <span className="text-red-500">*</span></label>
                  <input id="contactName" name="contactName" required autoComplete="name" placeholder="Tendai Moyo" className={fieldCls} />
                </div>
                <div>
                  <label htmlFor="contactEmail" className="mb-1 block text-sm font-medium">Work email <span className="text-red-500">*</span></label>
                  <input id="contactEmail" name="contactEmail" type="email" required autoComplete="email" placeholder="you@company.com" className={fieldCls} />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="orgName" className="mb-1 block text-sm font-medium">Organisation <span className="text-red-500">*</span></label>
                  <input id="orgName" name="orgName" required autoComplete="organization" placeholder="Company or project" className={fieldCls} />
                </div>
                <div>
                  <label htmlFor="teamSize" className="mb-1 block text-sm font-medium">Team size</label>
                  <select id="teamSize" name="teamSize" defaultValue="" className={fieldCls}>
                    <option value="" disabled>Select a range</option>
                    <option value="1–10">1–10</option>
                    <option value="11–50">11–50</option>
                    <option value="51–200">51–200</option>
                    <option value="200+">200+</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="needs" className="mb-1 block text-sm font-medium">What would you like to see?</label>
                <textarea
                  id="needs"
                  name="needs"
                  rows={2}
                  placeholder="e.g. tender tracking, timeline slippage, milestone payments (optional)."
                  className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none transition focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/25 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />
              </div>
              <SubmitButton size="lg" className="h-12 w-full rounded-xl text-base" pendingText="Sending…">
                Request your walkthrough
              </SubmitButton>
              <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
                No obligation, no card. Already have an account?{' '}
                <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">Sign in</Link>.
              </p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ─────────────────────────────────────────────────────────────────── */

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-600 dark:text-brand-400">FAQ</p>
        <h2 className="font-display mt-2 text-3xl font-bold tracking-[-0.02em]">Everything you need to know</h2>
      </div>
      <div className="mt-10 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-semibold sm:text-base">
              {q}
              <span className="text-zinc-400 transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ── Footer ──────────────────────────────────────────────────────────────── */

function Footer() {
  const cols: [string, [string, string][]][] = [
    ['Product', [['Timeline', '#product'], ['Sealed tendering', '#product'], ['In the field', '#field'], ['Governance', '#governance']]],
    ['Company', [['Enterprise', '/enterprise'], ['Security', '/security'], ['Privacy', '/privacy'], ['Terms', '/terms']]],
  ];
  return (
    <footer className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-3 md:col-span-2">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.svg" alt="" className="h-7 w-7 rounded-md" />
              <span className="font-display text-base font-bold">DatumPro</span>
            </div>
            <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
              Construction project management that unites field execution, sealed tenders, payments and a verifiable
              audit trail.
            </p>
          </div>
          {cols.map(([heading, links]) => (
            <div key={heading} className="flex flex-col gap-2.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-900 dark:text-white">{heading}</span>
              <ul className="flex flex-col gap-2">
                {links.map(([label, href]) =>
                  href.startsWith('#') ? (
                    <li key={label}>
                      <a href={href} className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">{label}</a>
                    </li>
                  ) : (
                    <li key={label}>
                      <Link href={href} className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">{label}</Link>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400 sm:flex-row">
          <p>© 2026 DatumPro · by Quillstone Digital</p>
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <Link href="/terms" className="hover:underline">Terms</Link>
            <Link href="/privacy" className="hover:underline">Privacy</Link>
            <Link href="/security" className="hover:underline">Security</Link>
            <ManageCookiesLink className="hover:underline" />
          </div>
        </div>
      </div>
    </footer>
  );
}
