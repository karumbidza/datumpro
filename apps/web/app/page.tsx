import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { Button } from '@/components/ui/button';
import { ManageCookiesLink } from '@/components/consent/manage-cookies-link';
import { Input, Textarea, Select, Label, Req, hintClass } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/submit-button';
import { requestDemo } from './request-demo-action';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://datumpro.app';

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: { absolute: 'DatumPro — Construction Project Management Software' },
  description:
    'Construction project management software that runs delivery, tendering and payments on a full audit trail — tasks & timelines, sealed tenders, contractor payments and approvals. Also used across healthcare, agriculture, infrastructure and public programmes. Request a demo.',
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
    description:
      'Run delivery, sealed tendering and contractor payments on one system with a full audit trail. Request a demo.',
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
    q: 'How do I get started?',
    a: 'Onboarding is managed by our team, not a self-serve signup. Request a demo and a specialist will be in touch within 8 hours to understand your projects, set up your organisation, and walk your team through it.',
  },
  {
    q: 'Who is DatumPro for?',
    a: 'Teams delivering real-world projects: project managers run delivery and money, contractors and suppliers see and price their own tasks, and clients get a read-only view of progress and their invoices.',
  },
  {
    q: 'Is DatumPro only for construction?',
    a: 'It is built for construction first, but the same system runs projects across industries — healthcare, agriculture, infrastructure, energy and public programmes. Anywhere work happens in the field and money needs a paper trail, it fits.',
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
        'DatumPro is a product of Quillstone Capital Private Limited, built by its Quillstone Digital division — construction project management software that runs delivery, tendering and payments on a full audit trail, also used across healthcare, agriculture and public programmes.',
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
        'Construction project management software: tasks with dependencies, planned-vs-actual timelines, sealed tendering, contractor payments and approvals with an audit trail. Used across construction, healthcare, agriculture and more.',
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
 *  Onboarding is admin-managed — there is no self-serve signup — so every
 *  primary call to action opens the "Request a demo" form. Everything shown is
 *  drawn with the app's own recipes (no screenshots), so the marketing page and
 *  the product can't drift apart visually. */
export default async function HomePage({ searchParams }: { searchParams?: Promise<{ demo?: string }> }) {
  const user = await getAuthUser();
  if (user) redirect('/dashboard');

  const demo = (await searchParams)?.demo;

  return (
    <main className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-white">
      <JsonLd />
      <TopNav />
      <Hero />
      <CapabilityStrip />
      <FeatureTrio />
      <FieldBand />
      <TrustRow />
      <DemoRequest status={demo} />
      <Faq />
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
          <a href="#product" className="hover:text-zinc-900 dark:hover:text-white">Product</a>
          <a href="#faq" className="hover:text-zinc-900 dark:hover:text-white">FAQ</a>
          <Link href="/enterprise" className="hover:text-zinc-900 dark:hover:text-white">Enterprise</Link>
        </nav>
        <div className="flex items-center gap-2.5">
          <Link href="/sign-in" className="hidden text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white sm:block">
            Sign in
          </Link>
          <a href="#demo">
            <Button size="sm">Request a demo</Button>
          </a>
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
            Construction project management — field to boardroom
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
            <a href="#demo">
              <Button size="lg" className="px-6">Request a demo</Button>
            </a>
            <Link href="/sign-in">
              <Button size="lg" variant="secondary" className="px-6">Sign in</Button>
            </Link>
          </div>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            A specialist will be in touch within 8 hours · onboarding managed by our team
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
    <div className="relative mx-auto mt-12 max-w-4xl">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-900/10 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-black/40">
        {/* Browser chrome */}
        <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex gap-1.5">
            <i className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <i className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <i className="h-2.5 w-2.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </span>
          <span className="ml-2 flex-1 truncate rounded border border-zinc-200 bg-white px-2.5 py-0.5 text-left font-mono text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
            datumpro.app/projects/riverside-office-block
          </span>
        </div>

        <div className="p-4 sm:p-6">
          {/* KPI tiles */}
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

          {/* Timeline rows */}
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

/* ── Feature trio ────────────────────────────────────────────────────────── */

function FeatureTrio() {
  return (
    <section id="product" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
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
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{b.label}</span>
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
              <div className="mt-2 flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
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
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Today · Riverside Office Block</p>
              <div className="mt-3 rounded-lg border border-zinc-800 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Slab reinforcement</p>
                  <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-medium text-blue-400">Active</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full w-[64%] rounded-full bg-brand-500" />
                </div>
                <p className="mt-1.5 text-[10px] text-zinc-400">7 of 11 steps done · due Fri</p>
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
    </section>
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

/* ── Request a demo ──────────────────────────────────────────────────────── */

/** Onboarding is admin-managed: instead of a self-serve signup, prospects
 *  request a demo and a specialist follows up within 8 hours. The form posts to
 *  the `requestDemo` server action, which records the intent (shared RPC) and
 *  fires a best-effort internal notification. On return, ?demo=sent|error drives
 *  the banner; the honeypot `website` field drops bots silently. */
function DemoRequest({ status }: { status?: string }) {
  if (status === 'sent') {
    return (
      <section id="demo" className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-xl text-green-700 dark:bg-green-500/15 dark:text-green-400">
            ✓
          </div>
          <h2 className="font-display mt-5 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
            Request received
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
            Thanks — a specialist will be in touch within 8 hours to arrange your demo and set up
            your organisation. Keep an eye on your inbox.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="demo" className="border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-16 sm:px-6 sm:py-20 md:grid-cols-2 lg:px-8">
        <div className="md:pt-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">Get started</p>
          <h2 className="font-display mt-2 text-3xl font-semibold tracking-[-0.02em]">
            Request a demo
          </h2>
          <p className="mt-3 max-w-md text-sm text-zinc-500 dark:text-zinc-400 sm:text-base">
            We manage onboarding for every organisation, so you start on a system that already fits
            your projects. Tell us a little about your work and a specialist will be in touch within
            8 hours.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
            {[
              'A walkthrough tailored to how you deliver',
              'Your organisation set up with you — not left to figure out',
              'No obligation, no card',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-brand-500/15 text-[10px] text-brand-600 dark:text-brand-400">
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
          {status === 'error' && (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              Something went wrong — please check your organisation and email and try again.
            </p>
          )}
          <form action={requestDemo} className="space-y-4">
            {/* Honeypot — hidden from humans, catches bots. */}
            <div aria-hidden className="hidden">
              <label>
                Leave this field empty
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>

            <div>
              <Label htmlFor="contactName">Your name <Req /></Label>
              <Input id="contactName" name="contactName" required autoComplete="name" placeholder="Tendai Moyo" />
            </div>
            <div>
              <Label htmlFor="contactEmail">Work email <Req /></Label>
              <Input id="contactEmail" name="contactEmail" type="email" required autoComplete="email" placeholder="you@company.com" />
            </div>
            <div>
              <Label htmlFor="orgName">Organisation <Req /></Label>
              <Input id="orgName" name="orgName" required autoComplete="organization" placeholder="Company or project name" />
            </div>
            <div>
              <Label htmlFor="teamSize">Team size</Label>
              <Select id="teamSize" name="teamSize" defaultValue="">
                <option value="" disabled>Select a range</option>
                <option value="1–10">1–10</option>
                <option value="11–50">11–50</option>
                <option value="51–200">51–200</option>
                <option value="200+">200+</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="needs">What would you like to see?</Label>
              <Textarea id="needs" name="needs" rows={3} placeholder="Tell us about your projects or what you're hoping to solve (optional)." />
            </div>

            <SubmitButton size="lg" className="w-full" pendingText="Sending…">
              Request a demo
            </SubmitButton>
            <p className={hintClass}>
              Already have an account?{' '}
              <Link href="/sign-in" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                Sign in
              </Link>
              .
            </p>
          </form>
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

/* ── Footer ──────────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-zinc-500 dark:text-zinc-400 sm:flex-row sm:px-6 lg:px-8">
        <p>© 2026 DatumPro · by Quillstone Digital</p>
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
