import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { Button } from '@/components/ui/button';
import { ManageCookiesLink } from '@/components/consent/manage-cookies-link';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://datumpro.app';

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: { absolute: 'DatumPro — Project Management Software for Real-World Work' },
  description:
    'Project management for real-world work — construction, healthcare, agriculture and more. Tasks & timelines, sealed tenders, payments and approvals with a full audit trail. $120/mo, first 3 months free.',
  keywords: [
    'project management software',
    'field project management',
    'construction project management',
    'healthcare project management',
    'agriculture project management',
    'tender management',
    'contractor payments',
    'project management Zimbabwe',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    title: 'DatumPro — Project Management Software for Real-World Work',
    description:
      'Construction, healthcare, agriculture and more — tasks & timelines, sealed tenders, payments, full audit trail. $120/month, first 3 months free.',
    url: '/',
    siteName: 'DatumPro',
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'DatumPro — project management for real-world work, field to boardroom' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DatumPro — Project Management Software for Real-World Work',
    description:
      'Construction, healthcare, agriculture and more — tasks & timelines, sealed tenders, payments, full audit trail. $120/month, first 3 months free.',
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
    q: 'How much does DatumPro cost?',
    a: 'One flat price: US$120 per month per organisation, with every feature included — projects, tendering, payments, site reports and the audit trail. Your first 3 months are free.',
  },
  {
    q: 'Is there a free trial?',
    a: 'Better — the first 3 months are completely free. Create your organisation, run real projects, and only pay from month four.',
  },
  {
    q: 'Who is DatumPro for?',
    a: 'Teams delivering real-world projects: project managers run delivery and money, contractors and suppliers see and price their own tasks, and clients get a read-only view of progress and their invoices.',
  },
  {
    q: 'Is DatumPro only for construction?',
    a: 'No. DatumPro manages projects across industries — construction, healthcare, agriculture, infrastructure, energy and public programmes. Anywhere work happens in the field and money needs a paper trail, it fits.',
  },
  {
    q: 'Does it work for site teams on phones?',
    a: 'Yes. Contractors join from a single phone-friendly invite screen, sign in with a 6-digit email code instead of a password, and progress rolls up from photo-evidenced site reports.',
  },
  {
    q: 'How is my data protected?',
    a: 'Access is role-scoped and enforced in the database, not just the interface. Every approval, award, payment and edit lands in an audit log, and organisations can enforce two-factor authentication.',
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
        'Project management software by Grafaid Engineers for real-world work across construction, healthcare, agriculture and more — delivery, tendering and payments with a full audit trail.',
      parentOrganization: { '@type': 'Organization', name: 'Grafaid Engineers' },
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
        'Project management for real-world work: tasks with dependencies, planned-vs-actual timelines, sealed tendering, contractor payments and approvals with an audit trail. Used across construction, healthcare, agriculture and more.',
      offers: {
        '@type': 'Offer',
        price: '120.00',
        priceCurrency: 'USD',
        description: 'US$120 per month per organisation. First 3 months free.',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
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

/** Public landing. Signed-in users skip straight to their dashboard.
 *  Everything shown is drawn with the app's own recipes (no screenshots), so
 *  the marketing page and the product can't drift apart visually. */
export default async function HomePage() {
  const user = await getAuthUser();
  if (user) redirect('/dashboard');

  return (
    <main className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-white">
      <JsonLd />
      <TopNav />
      <Hero />
      <CapabilityStrip />
      <Industries />
      <FeatureTrio />
      <FieldBand />
      <TrustRow />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ── Nav ─────────────────────────────────────────────────────────────────── */

function TopNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="h-7 w-7 rounded-md" />
          <span className="font-display text-[15px] font-semibold tracking-tight">DatumPro</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-zinc-600 dark:text-zinc-300 sm:flex">
          <a href="#delivery" className="hover:text-zinc-900 dark:hover:text-white">Product</a>
          <a href="#pricing" className="hover:text-zinc-900 dark:hover:text-white">Pricing</a>
          <a href="#faq" className="hover:text-zinc-900 dark:hover:text-white">FAQ</a>
          <Link href="/enterprise" className="hover:text-zinc-900 dark:hover:text-white">Enterprise</Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link href="/sign-in" className="hidden text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white sm:block">
            Sign in
          </Link>
          <Link href="/sign-in">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Faint blueprint grid behind the hero — the one decorative moment. */}
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
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
            For real-world projects — field to boardroom
          </p>
          <h1 className="font-display mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.02em] sm:text-5xl">
            Project management that runs the work,
            <br className="hidden sm:block" /> the money, and the paper trail.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-zinc-500 dark:text-zinc-400 sm:text-lg">
            DatumPro tracks every task against the plan, runs sealed tenders, and moves
            contractor payments with a full audit trail — so nothing lives in a notebook,
            a group chat, or someone&rsquo;s head.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/sign-in">
              <Button size="lg" className="px-6">Start free — 3 months on us</Button>
            </Link>
            <a href="#pricing">
              <Button size="lg" variant="secondary" className="px-6">See pricing</Button>
            </a>
          </div>
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">
            Then $120/month per organisation · every feature included
          </p>
        </div>

        <ProductMock />
      </div>
    </section>
  );
}

/** The hero visual: a browser frame around a hand-drawn slice of the real
 *  dashboard — KPI tiles and the planned-vs-actual timeline, using the same
 *  Tailwind recipes as the product. */
function ProductMock() {
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
      note: { text: '✓ 2d early', cls: 'text-green-600 dark:text-green-400', at: '30%' },
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
      note: { text: '3d left', cls: 'text-zinc-400 dark:text-zinc-500', at: '60%' },
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
      note: { text: 'blocked — cable delivery', cls: 'text-amber-600 dark:text-amber-400', at: '70%' },
    },
    {
      title: 'Blockwork ground floor',
      who: 'Tender · 3 sealed bids',
      chip: 'Tender',
      chipCls: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400',
      bar: [{ left: '52%', width: '30%', cls: 'bg-zinc-200 dark:bg-zinc-800' }],
      note: { text: 'award opens Fri', cls: 'text-zinc-400 dark:text-zinc-500', at: '84%' },
    },
  ];

  return (
    <div className="relative mx-auto mt-12 max-w-4xl">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <i className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <i className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </span>
          <span className="ml-2 flex-1 truncate rounded border border-zinc-200 bg-white px-2.5 py-0.5 text-left font-mono text-[10px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-500">
            datumpro.app/projects/riverside-office-block
          </span>
        </div>

        <div className="p-4 sm:p-6">
          {/* KPI tiles */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Progress vs plan', value: '62%', sub: 'target 58% — ahead', tone: 'text-green-600 dark:text-green-400' },
              { label: 'Active blockers', value: '1', sub: 'cable delivery', tone: 'text-amber-600 dark:text-amber-400' },
              { label: 'Budget committed', value: '$311k', sub: 'of $480k', tone: 'text-zinc-500 dark:text-zinc-400' },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border border-zinc-200 p-3 text-left dark:border-zinc-800">
                <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">{k.label}</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums sm:text-2xl">{k.value}</p>
                <p className={`text-[11px] ${k.tone}`}>{k.sub}</p>
              </div>
            ))}
          </div>

          {/* Timeline rows */}
          <div className="mt-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <span className="text-xs font-medium">Timeline — planned vs actual</span>
              <span className="text-[10px] text-zinc-400">Week 31</span>
            </div>
            <div className="space-y-1 p-3">
              {rows.map((r) => (
                <div key={r.title} className="flex items-center gap-3">
                  <div className="w-36 shrink-0 text-left sm:w-44">
                    <p className="flex items-center gap-1.5 truncate text-xs font-medium">
                      <span className="truncate">{r.title}</span>
                      <span className={`shrink-0 rounded px-1 py-px text-[9px] font-medium ${r.chipCls}`}>{r.chip}</span>
                    </p>
                    <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">{r.who}</p>
                  </div>
                  <div className="relative h-8 flex-1">
                    {/* today line */}
                    <span className="absolute inset-y-0 left-[44%] w-px bg-brand-500/40" />
                    {r.bar.map((b, i) => (
                      <span
                        key={i}
                        className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm ${b.cls}`}
                        style={{ left: b.left, width: b.width }}
                      />
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
        </div>
      </div>
    </div>
  );
}

/* ── Capability strip ────────────────────────────────────────────────────── */

function CapabilityStrip() {
  const items = [
    'Tasks & dependencies',
    'Planned vs actual',
    'Sealed tendering',
    'Site reports & photos',
    'Payments & proof of payment',
    'Approvals & audit log',
  ];
  return (
    <section className="border-y border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 py-5 sm:px-6 lg:px-8">
        {items.map((t) => (
          <span key={t} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t}</span>
        ))}
      </div>
    </section>
  );
}

/* ── Industries ──────────────────────────────────────────────────────────── */

function Industries() {
  const industries: [string, string][] = [
    ['🏗️', 'Construction'],
    ['🏥', 'Healthcare'],
    ['🌾', 'Agriculture'],
    ['⚡', 'Infrastructure & energy'],
    ['🏭', 'Manufacturing'],
    ['🏛️', 'Public programmes & NGOs'],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          One system, any industry
        </h2>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
          Wherever work happens in the field and money needs a paper trail — DatumPro runs the
          project. Building a clinic, a road, an irrigation scheme or a plant: same plan, same
          discipline.
        </p>
      </div>
      <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
        {industries.map(([icon, name]) => (
          <li
            key={name}
            className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <span aria-hidden>{icon}</span>
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Feature trio ────────────────────────────────────────────────────────── */

function FeatureTrio() {
  return (
    <section id="delivery" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">The whole job, one system</p>
        <h2 className="font-display mt-2 text-3xl font-semibold tracking-[-0.02em]">
          Delivery, tendering, and money — connected
        </h2>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
          Each task carries its schedule, its contract, and its payments. When something slips,
          you see it the day it slips — not at month-end.
        </p>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {/* Delivery */}
        <FeatureCard
          title="Delivery you can defend"
          body="Tasks with dependencies, a live planned-vs-actual timeline, blockers with reasons, and SLA states that escalate before the deadline — not after."
          visual={
            <div className="space-y-1.5">
              {[
                { w: '85%', cls: 'bg-green-600', label: '✓ done' },
                { w: '55%', cls: 'bg-brand-500', label: 'active' },
                { w: '30%', cls: 'bg-amber-500', label: 'blocked' },
              ].map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`h-2 rounded-sm ${b.cls}`} style={{ width: b.w }} />
                  <span className="text-[10px] text-zinc-400">{b.label}</span>
                </div>
              ))}
            </div>
          }
        />
        {/* Tendering */}
        <FeatureCard
          title="Tenders without the drama"
          body="Put a task out to sealed bids. Contractors price their own plan, nobody sees anyone else's number, and the award writes the contract into the task."
          visual={
            <div className="space-y-1.5">
              {[
                { who: 'Moyo Electrical', amt: '•••••', win: false },
                { who: 'PowerGrid Co.', amt: '•••••', win: false },
                { who: 'Amp Solutions', amt: '$8,400', win: true },
              ].map((b) => (
                <div
                  key={b.who}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-[11px] ${
                    b.win
                      ? 'border-brand-500/50 bg-brand-50 font-medium dark:bg-brand-500/10'
                      : 'border-zinc-200 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400'
                  }`}
                >
                  <span>{b.who}</span>
                  <span className="tabular-nums">{b.win ? `${b.amt} · awarded` : b.amt}</span>
                </div>
              ))}
            </div>
          }
        />
        {/* Money */}
        <FeatureCard
          title="Money with a paper trail"
          body="Budget vs committed vs paid per task and per project. Contractors request payment, approvers sign off, and proof of payment attaches to the record."
          visual={
            <div>
              <div className="flex h-3 overflow-hidden rounded-full">
                <span className="w-[52%] bg-brand-500" />
                <span className="w-[18%] bg-brand-300 dark:bg-brand-500/40" />
                <span className="flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
                <span>Paid $250k</span>
                <span>Committed $86k</span>
                <span>Budget $480k</span>
              </div>
            </div>
          }
        />
      </div>
    </section>
  );
}

function FeatureCard({ title, body, visual }: { title: string; body: string; visual: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="rounded-md border border-zinc-100 bg-zinc-50/60 p-3 dark:border-zinc-800/60 dark:bg-zinc-900/40">{visual}</div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{body}</p>
    </div>
  );
}

/* ── Field band (dark in both themes) ────────────────────────────────────── */

function FieldBand() {
  return (
    <section className="bg-zinc-950 text-white">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 sm:py-20 md:grid-cols-2 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-400">Built for the field</p>
          <h2 className="font-display mt-2 text-3xl font-semibold tracking-[-0.02em]">
            Your field team doesn&rsquo;t need a manual
          </h2>
          <ul className="mt-6 space-y-4 text-sm text-zinc-300">
            {[
              ['Contractors join in one screen', 'An invite sets up their profile — phone-first, WhatsApp-friendly — and they only ever see their own tasks and money.'],
              ['Sign-in is a 6-digit code', 'No passwords to forget in the field. The app signs in with a code from email.'],
              ['Progress is proof, not promises', 'Field reports carry photos; task progress rolls up from ticked, evidenced steps — the office sees it live.'],
            ].map(([t, b]) => (
              <li key={t} className="flex gap-3">
                <span className="mt-1 h-4 w-4 flex-none rounded-full bg-brand-500/20 text-center text-[10px] leading-4 text-brand-400">✓</span>
                <span>
                  <span className="font-medium text-white">{t}</span>
                  <br />
                  <span className="text-zinc-400">{b}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Phone mock — the field app's task card */}
        <div className="mx-auto w-full max-w-[280px]">
          <div className="rounded-[28px] border border-zinc-800 bg-zinc-900 p-2 shadow-2xl shadow-black/50">
            <div className="rounded-[22px] bg-zinc-950 p-4">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Today · Riverside Office Block</p>
              <div className="mt-3 rounded-lg border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Slab reinforcement</p>
                  <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-medium text-blue-400">Active</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full w-[64%] rounded-full bg-brand-500" />
                </div>
                <p className="mt-1.5 text-[10px] text-zinc-500">7 of 11 steps done · due Fri</p>
                <div className="mt-3 flex gap-2">
                  <span className="flex-1 rounded-md bg-brand-500 py-1.5 text-center text-[11px] font-semibold">Tick step</span>
                  <span className="flex-1 rounded-md border border-zinc-700 py-1.5 text-center text-[11px] text-zinc-300">Add photo</span>
                </div>
              </div>
              <div className="mt-2 rounded-lg border border-zinc-800 p-3">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-zinc-300">Payment request — $2,150</span>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">Awaiting</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ProjectGallery />
    </section>
  );
}

/** Auto-scrolling gallery inside the dark band — projects and industries in
 *  motion. Images live in /public/gallery; drop real site photos in with the
 *  same filenames to replace the branded placeholder scenes (no code change).
 *  The list is duplicated once so the -50% marquee loops seamlessly; hover
 *  pauses it, and reduced-motion users get a plain scrollable strip. */
function ProjectGallery() {
  const cards: { img: string; title: string; tag: string }[] = [
    { img: 'office-block', title: 'Office block build', tag: 'Construction' },
    { img: 'clinic', title: 'District clinic', tag: 'Healthcare' },
    { img: 'irrigation', title: 'Irrigation scheme', tag: 'Agriculture' },
    { img: 'solar', title: 'Solar plant', tag: 'Energy' },
    { img: 'factory', title: 'Processing line', tag: 'Manufacturing' },
    { img: 'road', title: 'Road programme', tag: 'Public works' },
    { img: 'site-team', title: 'Site teams on the app', tag: 'In the field' },
    { img: 'handover', title: 'Client handover day', tag: 'Delivered' },
  ];
  const strip = [...cards, ...cards]; // duplicate for the seamless loop
  return (
    <div className="marquee overflow-hidden border-t border-zinc-800/80 py-8" aria-label="Projects across industries">
      <div className="marquee-track flex w-max gap-4 px-4">
        {strip.map((c, i) => (
          <figure
            key={`${c.img}-${i}`}
            className="w-60 shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 sm:w-72"
            aria-hidden={i >= cards.length || undefined}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/gallery/${c.img}.jpg`}
              alt={i < cards.length ? `${c.title} — ${c.tag}` : ''}
              width={640}
              height={420}
              loading="lazy"
              className="aspect-[3/2] w-full object-cover"
            />
            <figcaption className="flex items-center justify-between gap-2 px-3.5 py-2.5">
              <span className="truncate text-xs font-medium text-white">{c.title}</span>
              <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                {c.tag}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/* ── Trust row ───────────────────────────────────────────────────────────── */

function TrustRow() {
  const items: [string, string, string][] = [
    ['Role-scoped access', 'PMs, contractors, clients and viewers each see exactly their slice — enforced in the database, not just the UI.', '/security'],
    ['Every action on the record', 'Approvals, awards, payments and edits land in an audit log your client can stand behind.', '/security'],
    ['Ready for bigger jobs', 'Two-person approvals, 2FA enforcement, verified email domains — when the organisation needs it.', '/enterprise'],
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="grid gap-5 md:grid-cols-3">
        {items.map(([t, b, href]) => (
          <Link
            key={t}
            href={href}
            className="rounded-lg border border-zinc-200 p-5 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
          >
            <h3 className="text-sm font-semibold">{t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{b}</p>
            <span className="mt-3 inline-block text-xs font-medium text-brand-600 dark:text-brand-400">Learn more →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ── Pricing ─────────────────────────────────────────────────────────────── */

function Pricing() {
  const included = [
    'Unlimited projects and tasks',
    'Planned-vs-actual timelines & SLA tracking',
    'Sealed tendering and awards',
    'Contractor payments & proof of payment',
    'Site reports with photos',
    'Role-scoped access for PMs, contractors & clients',
    'Approvals, audit log & optional 2FA',
    'Web + mobile field app',
  ];
  return (
    <section id="pricing" className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Pricing</p>
          <h2 className="font-display mt-2 text-3xl font-semibold tracking-[-0.02em]">
            One flat price. First 3 months free.
          </h2>
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
            No per-seat maths, no feature tiers. Every role — PM, contractor, client — is included.
          </p>
        </div>

        <div className="mx-auto mt-10 max-w-md">
          <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/30">
            <div className="bg-brand-500 px-6 py-2.5 text-center text-sm font-semibold text-white">
              Your first 3 months are free
            </div>
            <div className="p-6 sm:p-8">
              <div className="flex items-end justify-center gap-2">
                <span className="font-display text-5xl font-semibold tracking-tight">$120</span>
                <span className="pb-1.5 text-sm text-zinc-500 dark:text-zinc-400">/ month · per organisation</span>
              </div>
              <p className="mt-2 text-center text-xs text-zinc-400 dark:text-zinc-500">
                Pay nothing until month four. Cancel any time.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {included.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-zinc-600 dark:text-zinc-300">
                    <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-green-100 text-[10px] text-green-700 dark:bg-green-500/15 dark:text-green-400">
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <Link href="/sign-in" className="mt-7 block">
                <Button size="lg" className="w-full">Start free — 3 months on us</Button>
              </Link>
              <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-500">
                Larger organisation?{' '}
                <Link href="/enterprise" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  Talk to us about enterprise →
                </Link>
              </p>
            </div>
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
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">FAQ</p>
        <h2 className="font-display mt-2 text-3xl font-semibold tracking-[-0.02em]">Frequently asked questions</h2>
      </div>
      <div className="mt-10 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-semibold sm:text-base">
              {q}
              <span className="text-zinc-400 transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ── CTA + footer ────────────────────────────────────────────────────────── */

function FinalCta() {
  return (
    <section className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 className="font-display text-3xl font-semibold tracking-[-0.02em]">
          Put your next project on DatumPro
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          Create the project, invite the team, and see the whole job on one timeline this week —
          free for your first 3 months.
        </p>
        <div className="mt-7 flex justify-center">
          <Link href="/sign-in">
            <Button size="lg" className="px-8">Get started — free</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-zinc-500 dark:text-zinc-400 sm:flex-row sm:px-6 lg:px-8">
        <p>© 2026 DatumPro · by Grafaid Engineers</p>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link href="/terms" className="hover:underline">Terms</Link>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          <Link href="/security" className="hover:underline">Security</Link>
          <Link href="/enterprise" className="hover:underline">Enterprise</Link>
          <ManageCookiesLink className="hover:underline" />
        </div>
      </div>
    </footer>
  );
}
