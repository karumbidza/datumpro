import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/data/org';
import { MarketingFooter, MarketingNav, focusRing } from '@/components/marketing/chrome';
import { newsreader } from '@/components/marketing/font';
import { SubmitButton } from '@/components/ui/submit-button';
import { requestDemo } from './request-demo-action';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://datumpro.app';

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
    a: 'General task tools have no construction logic — no critical-path dependencies, no bill of quantities, no sealed tendering, no photo-evidenced sign-off. DatumPro is built around exactly those, phone-first, so site teams pick it up in minutes.',
  },
  {
    q: 'How is this different from WhatsApp groups and spreadsheets?',
    a: 'A group chat can’t seal a bid, hold a photo against a milestone, or tell you which tasks are late against the plan. DatumPro keeps the conversation — every task carries its own discussion — and adds the programme, the money and the record that spreadsheets lose.',
  },
  {
    q: 'How does sealed tendering and contractor payment work?',
    a: 'Bids stay sealed until the deadline, so nobody inside or outside sees a number early, and the award writes the contract straight into the task. Payments then move against milestones that need photo evidence and sign-off, with every step in the audit log.',
  },
  {
    q: 'Can we run it on a Zimbabwean site with patchy signal?',
    a: 'It’s built phone-first for exactly that: screens are light on data, photos are compressed before upload, and sign-in is a 6-digit email code. You do need a connection to submit — when you’re offline the app says so plainly and you retry once signal returns.',
  },
  {
    q: 'Do subcontractors need a paid licence or an app download?',
    a: 'No. They join from one phone-friendly invite, sign in with a 6-digit email code instead of a password, and only ever see their own tasks and money.',
  },
  {
    q: 'How do I get started?',
    a: 'Onboarding is managed by our team, not a self-serve signup. Request a demo and a specialist will be in touch within 8 hours to set up your organisation and bring your existing schedule across.',
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
  // JSON-LD must ship as a literal script tag. Content is exclusively our own
  // constants above (no user input); '<' is escaped so no markup can ever be
  // interpreted even if a constant were to contain it.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

/** Public landing. Signed-in users skip straight to their dashboard. Onboarding
 *  is admin-managed — no self-serve signup — so every primary CTA opens the
 *  "Request a demo" form. Product visuals are faithful HTML recreations of the
 *  app, populated only with the Meridian Construction demo organisation's data
 *  (docs/DEMO.md) so the page can neither drift from the product nor invent
 *  numbers. */
export default async function HomePage({ searchParams }: { searchParams?: Promise<{ demo?: string }> }) {
  const user = await getAuthUser();
  if (user) redirect('/dashboard');

  const demo = (await searchParams)?.demo;

  return (
    <main className={`landing ${newsreader.variable} bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50`}>
      <JsonLd />
      <MarketingNav />
      <Hero />
      <ClaimWork />
      <ClaimMoney />
      <ClaimRecord />
      <WorthIt />
      <FieldRow />
      <PricingLine />
      <DemoRequest status={demo} />
      <Faq />
      <MarketingFooter />
    </main>
  );
}

/* Shared bits ─────────────────────────────────────────────────────────────── */

function ArrowIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-24 lg:px-8">
      <h1
        className="land-rise max-w-[24ch] text-[2.6rem] font-medium leading-[1.04] tracking-[-0.02em] sm:text-6xl lg:text-[4.4rem]"
        style={{ textWrap: 'balance', fontOpticalSizing: 'auto' }}
      >
        Project management that runs the work, the money, and the paper trail.
      </h1>
      <p className="land-rise mt-6 max-w-[58ch] text-lg leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-xl" style={{ animationDelay: '90ms' }}>
        DatumPro tracks every task against the plan, runs sealed subcontractor tenders, and releases milestone payments
        against photo evidence — so nothing lives in a notebook, a group chat, or someone&rsquo;s head.
      </p>
      <div className="land-rise mt-9 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: '180ms' }}>
        <a
          href="#demo"
          className={`group inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand-600 px-7 text-base font-medium text-white transition-colors hover:bg-brand-700 ${focusRing}`}
        >
          Request a demo
          <ArrowIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </a>
        <a
          href="#work"
          className={`inline-flex h-12 items-center justify-center px-2 text-base text-zinc-700 underline decoration-zinc-300 underline-offset-4 transition-colors hover:decoration-zinc-500 dark:text-zinc-300 dark:decoration-zinc-600 dark:hover:decoration-zinc-400 ${focusRing}`}
        >
          See the programme view
        </a>
      </div>
      <p className="land-rise mt-6 text-sm text-zinc-600 dark:text-zinc-400" style={{ animationDelay: '260ms' }}>
        Response within 8 hours&ensp;·&ensp;specialist onboarding&ensp;·&ensp;no card required
      </p>

      <div className="land-rise mt-14 sm:mt-16" style={{ animationDelay: '340ms' }}>
        <DashboardShot />
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          The portfolio dashboard — Meridian Construction&rsquo;s demo organisation, as it runs today.
        </p>
      </div>
    </section>
  );
}

/* ── Product recreations ──────────────────────────────────────────────────
   Rendered in the app's own font and palette; every figure and name comes from
   the seeded Meridian demo org (docs/DEMO.md). Nothing here is invented. */

function DashboardShot() {
  const projects = [
    { name: 'Riverside Mall Fit-Out', stage: 'Completed · practical completion recorded', pct: 100, cls: 'bg-green-600' },
    { name: 'Hillside Apartments — Block A', stage: 'Finishing & snagging · 1 task awaiting sign-off', pct: 90, cls: 'bg-brand-600' },
    { name: 'Central Clinic Extension', stage: 'Early works & substructure', pct: 18, cls: 'bg-brand-600' },
  ];
  return (
    <figure
      className="overflow-hidden rounded-xl font-sans shadow-[0_24px_60px_-24px_rgba(24,24,27,0.28)] ring-1 ring-zinc-950/5 dark:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.7)] dark:ring-white/10"
      aria-label="DatumPro portfolio dashboard showing three projects"
    >
      <div className="bg-white p-5 dark:bg-zinc-900 sm:p-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Good afternoon, Patience</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">3 projects · Meridian Construction</p>
          </div>
          <div className="flex gap-6 text-sm">
            {[
              ['Awaiting sign-off', '1'],
              ['Blockers', '1'],
              ['Claims to review', '2'],
            ].map(([label, n], i) => (
              <div key={label} className="text-right">
                <p className={`text-xl font-semibold tabular-nums ${i === 2 ? 'text-brand-600 dark:text-brand-400' : 'text-zinc-900 dark:text-zinc-50'}`}>{n}</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{label}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-6 space-y-4">
          {projects.map((p) => (
            <div key={p.name}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{p.name}</p>
                  <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{p.stage}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{p.pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className={`h-full rounded-full ${p.cls}`} style={{ width: `${p.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-zinc-100 pt-4 text-sm dark:border-zinc-800">
          {[
            ['Paid', '$440k'],
            ['Approved', '$156k'],
            ['Awaiting review', '$100k'],
          ].map(([label, amt]) => (
            <p key={label} className="text-zinc-600 dark:text-zinc-400">
              {label} <span className="ml-1 font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{amt}</span>
            </p>
          ))}
        </div>
      </div>
    </figure>
  );
}

function ProgrammeShot() {
  /* Hillside Apartments — the three tasks the demo script walks through. */
  const rows = [
    {
      name: 'Plastering & screeds',
      who: 'BuildRight Civils',
      state: 'Done',
      stateCls: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-400',
      bars: [{ left: '4%', width: '30%', cls: 'bg-green-600' }],
    },
    {
      name: 'Internal finishes & painting',
      who: 'Submitted for sign-off',
      state: 'Submitted',
      stateCls: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-400',
      bars: [
        { left: '28%', width: '40%', cls: 'bg-zinc-200 dark:bg-zinc-700' },
        { left: '28%', width: '36%', cls: 'bg-brand-600' },
      ],
    },
    {
      name: 'Balcony balustrades',
      who: 'Blocker raised',
      state: 'Blocked',
      stateCls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
      bars: [
        { left: '48%', width: '34%', cls: 'bg-zinc-200 dark:bg-zinc-700' },
        { left: '48%', width: '12%', cls: 'bg-amber-500' },
      ],
    },
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-zinc-200 font-sans dark:border-zinc-800" aria-label="Programme view of Hillside Apartments with planned versus actual bars">
      <div className="bg-white p-5 dark:bg-zinc-900 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Hillside Apartments — Block A</p>
          <p className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">Programme · planned vs actual · 90%</p>
        </div>
        <div className="mt-4 space-y-3">
          {rows.map((r) => (
            <div key={r.name} className="flex items-center gap-4">
              <div className="w-40 shrink-0 sm:w-48">
                <p className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-50">{r.name}</p>
                <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{r.who}</p>
              </div>
              <div className="relative h-7 flex-1">
                <span className="absolute inset-y-0 left-[64%] w-px bg-zinc-300 dark:bg-zinc-600" aria-hidden />
                {r.bars.map((b, i) => (
                  <span key={i} className={`absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm ${b.cls}`} style={{ left: b.left, width: b.width }} />
                ))}
              </div>
              <span className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium sm:inline ${r.stateCls}`}>{r.state}</span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

function TenderShot() {
  /* The demo org's three contractor companies, bidding sealed. No amounts are
     shown because sealed is the point — and the demo defines none. */
  const bidders = ['BuildRight Civils', 'AquaPlumb Services', 'Spark Electrical'];
  return (
    <figure className="overflow-hidden rounded-xl border border-zinc-200 font-sans dark:border-zinc-800" aria-label="A sealed tender with three bids hidden until the deadline">
      <div className="bg-white p-5 dark:bg-zinc-900 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Tender — Earthworks · Central Clinic Extension</p>
          <p className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">Unseals Fri 12:00</p>
        </div>
        <div className="mt-4 space-y-2">
          {bidders.map((who) => (
            <div key={who} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3.5 py-2.5 text-sm dark:border-zinc-700">
              <span className="font-medium text-zinc-900 dark:text-zinc-50">{who}</span>
              <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden className="h-3.5 w-3.5">
                  <rect width="18" height="11" x="3" y="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span aria-label="amount sealed">•••••</span>
                <span className="text-xs">sealed</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

function AuditShot() {
  /* Log lines re-derived from the demo script's own events and actors. */
  const entries = [
    { at: 'Today 14:02', who: 'Patience Ncube', what: 'approved “Internal finishes & painting”', where: 'Hillside Apartments' },
    { at: 'Today 11:47', who: 'Brian · BuildRight Civils', what: 'submitted claim — “Plastering & screeds”', where: 'photo evidence attached' },
    { at: 'Yesterday 16:20', who: 'Patience Ncube + Allen Karumbidza', what: 'released payment — two-person sign-off', where: 'Riverside Mall Fit-Out' },
    { at: 'Yesterday 09:15', who: 'System', what: 'tender unsealed — 3 bids revealed at deadline', where: 'Central Clinic Extension' },
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-zinc-200 font-sans dark:border-zinc-800" aria-label="Audit log entries for approvals, claims, payments and tender unsealing">
      <div className="bg-white p-5 dark:bg-zinc-900 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Audit log</p>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">Meridian Construction · all projects</p>
        </div>
        <ol className="mt-4">
          {entries.map((e, i) => (
            <li key={e.at + e.what} className={`flex gap-4 py-3 text-sm ${i > 0 ? 'border-t border-zinc-100 dark:border-zinc-800' : ''}`}>
              <span className="w-28 shrink-0 text-xs tabular-nums leading-5 text-zinc-600 dark:text-zinc-400">{e.at}</span>
              <span className="min-w-0 text-zinc-700 dark:text-zinc-300">
                <span className="font-medium text-zinc-900 dark:text-zinc-50">{e.who}</span> {e.what}
                <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">{e.where}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}

function PhoneShot() {
  return (
    <figure className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[1.75rem] border border-zinc-200 font-sans dark:border-zinc-700" aria-label="The mobile app: a milestone claim with photo evidence, awaiting review">
      <div className="bg-white p-4 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-100 pb-3 dark:border-zinc-800">
          <div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Hillside Apartments</p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Plastering &amp; screeds</p>
          </div>
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/15 dark:text-green-400">Done</span>
        </div>
        {/* Photo-evidence attachment row, as the app renders it. */}
        <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center gap-2.5 p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4.5 w-4.5">
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-50">site-photo.jpg</span>
              <span className="block truncate text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">−17.83, 31.05 · 11:42</span>
            </span>
            <span className="ml-auto shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/15 dark:text-green-400">
              Geotagged
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400">Milestone claim</p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Submitted</p>
          </div>
          <span className="whitespace-nowrap rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">Awaiting review</span>
        </div>
      </div>
    </figure>
  );
}

/* ── Claim sections — one claim, shown once ──────────────────────────────── */

function ClaimSection({
  id,
  title,
  children,
  evidence,
  caption,
  flip = false,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  evidence: React.ReactNode;
  caption: string;
  flip?: boolean;
}) {
  return (
    <section id={id} className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-12 lg:gap-16 lg:px-8">
        <div className={`lg:col-span-5 ${flip ? 'lg:order-2' : ''}`}>
          <h2 className="text-3xl font-medium leading-tight tracking-[-0.015em] sm:text-4xl" style={{ textWrap: 'balance' }}>
            {title}
          </h2>
          <div className="mt-5 max-w-[52ch] space-y-4 text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</div>
        </div>
        <div className={`lg:col-span-7 ${flip ? 'lg:order-1' : ''}`}>
          {evidence}
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{caption}</p>
        </div>
      </div>
    </section>
  );
}

function ClaimWork() {
  return (
    <ClaimSection
      id="work"
      title="Every task, tracked against the plan."
      evidence={<ProgrammeShot />}
      caption="Hillside Apartments — the demo org's live programme, planned vs actual."
    >
      <p>
        The programme is live, not a PDF. Dependencies drive the dates, so when something slips you see it the day it
        slips — not at month-end. Blockers carry a reason and an owner, on the record.
      </p>
    </ClaimSection>
  );
}

function ClaimMoney() {
  return (
    <ClaimSection
      id="money"
      title="Prices stay sealed until the deadline."
      evidence={<TenderShot />}
      caption="A sealed tender in the demo org — three bids, no numbers until Friday."
      flip
    >
      <p>
        Put a task out to tender and every bid stays sealed — inside and outside the company — until the clock runs
        out. Bids open all at once, side by side, and the award writes the contract straight into the task.
      </p>
    </ClaimSection>
  );
}

function ClaimRecord() {
  return (
    <ClaimSection
      id="record"
      title="Every approval on the record."
      evidence={<AuditShot />}
      caption="The audit log — approvals, claims, releases and unsealings, timestamped."
    >
      <p>
        Milestone payments move only on photo evidence and sign-off — two people, not one. Every award, approval and
        release lands in a timestamped audit log your client can stand behind.
      </p>
      <p>
        Access is scoped in the database itself, not just the interface: contractors never see competing bids, other
        trades&rsquo; money, or project margins.
      </p>
    </ClaimSection>
  );
}

/* ── Worth it ────────────────────────────────────────────────────────────── */

function WorthIt() {
  const pairs: [string, string][] = [
    [
      'A disputed claim.',
      'Milestones need a geotagged, timestamped photo before they can be marked done — the evidence is attached before the argument starts.',
    ],
    [
      'A leaked tender price.',
      'Sealed bids open all at once, after the deadline. Nobody inside or outside the company sees a number early.',
    ],
    [
      'A payment with no proof.',
      'Releases take two sign-offs and land in the audit log with the claim, the photo, and the approvers’ names.',
    ],
  ];
  return (
    <section className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <h2 className="max-w-[20ch] text-3xl font-medium leading-tight tracking-[-0.015em] sm:text-4xl" style={{ textWrap: 'balance' }}>
          What the usual way costs.
        </h2>
        <dl className="mt-12 max-w-3xl space-y-10">
          {pairs.map(([problem, answer]) => (
            <div key={problem} className="grid gap-2 sm:grid-cols-12 sm:gap-8">
              <dt className="text-lg font-medium sm:col-span-4">{problem}</dt>
              <dd className="text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400 sm:col-span-8">{answer}</dd>
            </div>
          ))}
        </dl>
        {/*
          CUSTOMER QUOTE SLOT — drop a named customer quote here when one exists.
          Keep it factual and attributed (name, role, company). Example shape:

          <blockquote className="mt-14 max-w-2xl border-t border-zinc-200 pt-8 dark:border-zinc-800">
            <p className="text-xl italic leading-relaxed">“…”</p>
            <footer className="mt-3 text-sm text-zinc-500">Name — role, company</footer>
          </blockquote>
        */}
      </div>
    </section>
  );
}

/* ── Field row ───────────────────────────────────────────────────────────── */

function FieldRow() {
  const points: [string, string][] = [
    ['Join in one screen', 'The invite is phone-first and WhatsApp-friendly. It sets up their profile; they only ever see their own tasks and money.'],
    ['Sign in with a 6-digit code', 'No passwords to forget on site — a one-time code from email, in seconds.'],
    ['Progress is proof', 'A geotagged, timestamped photo before a milestone can close. The claim arrives with its evidence.'],
  ];
  return (
    <section id="field" className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-12 lg:gap-16 lg:px-8">
        <div className="lg:col-span-7">
          <h2 className="text-3xl font-medium leading-tight tracking-[-0.015em] sm:text-4xl" style={{ textWrap: 'balance' }}>
            Your site crews won&rsquo;t need training.
          </h2>
          <div className="mt-8 max-w-[56ch] space-y-6">
            {points.map(([t, b]) => (
              <div key={t}>
                <h3 className="text-lg font-medium">{t}</h3>
                <p className="mt-1 text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{b}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="lg:col-span-5">
          <PhoneShot />
          <p className="mt-3 text-center text-sm text-zinc-600 dark:text-zinc-400">A milestone claim from the field, evidence first.</p>
        </div>
      </div>
    </section>
  );
}

/* ── Pricing ─────────────────────────────────────────────────────────────── */

function PricingLine() {
  return (
    <section className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <p className="max-w-[44ch] text-2xl font-medium leading-snug tracking-[-0.01em] sm:text-3xl" style={{ textWrap: 'balance' }}>
          Priced per organisation and per active project — ask for a quote in your walkthrough.
        </p>
      </div>
    </section>
  );
}

/* ── Request a demo ──────────────────────────────────────────────────────── */

const fieldCls =
  'h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 font-sans text-sm text-zinc-900 placeholder:text-zinc-600 outline-none transition focus:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400';

/** Onboarding is admin-managed: prospects request a demo and a specialist
 *  follows up within 8 hours. Posts to the `requestDemo` server action, which
 *  records the intent (shared RPC) and fires a best-effort notification.
 *  ?demo=sent|error drives the state; honeypot `website` drops bots. */
function DemoRequest({ status }: { status?: string }) {
  if (status === 'sent') {
    return (
      <section id="demo" className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto max-w-2xl px-4 py-24 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-medium tracking-[-0.015em] sm:text-4xl">Request received.</h2>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Thanks — a specialist will be in touch within 8 hours to arrange your walkthrough and set up your
            organisation. Keep an eye on your inbox.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="demo" className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-12 lg:gap-16 lg:px-8">
        <div className="lg:col-span-5">
          <h2 className="text-3xl font-medium leading-tight tracking-[-0.015em] sm:text-4xl" style={{ textWrap: 'balance' }}>
            A walkthrough tailored to how you deliver.
          </h2>
          <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            See DatumPro running against your own kind of work — your subcontractor tiers and approval chains, not a
            generic demo. A specialist sets up your organisation with you and helps bring your existing schedule and
            contacts across.
          </p>
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">Response within 8 hours&ensp;·&ensp;no obligation, no card.</p>
        </div>

        <div className="lg:col-span-7">
          {status === 'error' && (
            <p role="alert" className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-sans text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              Something went wrong — please check your organisation and email and try again.
            </p>
          )}
          <form action={requestDemo} className="space-y-5">
            {/* Honeypot — hidden from humans, catches bots. */}
            <div aria-hidden className="hidden">
              <label>
                Leave this field empty
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="contactName" className="mb-1.5 block text-sm font-medium">
                  Full name <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input id="contactName" name="contactName" required autoComplete="name" placeholder="Tendai Moyo" className={fieldCls} />
              </div>
              <div>
                <label htmlFor="contactEmail" className="mb-1.5 block text-sm font-medium">
                  Work email <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input id="contactEmail" name="contactEmail" type="email" required autoComplete="email" placeholder="you@company.com" className={fieldCls} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div>
                <label htmlFor="orgName" className="mb-1.5 block text-sm font-medium">
                  Organisation <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
                </label>
                <input id="orgName" name="orgName" required autoComplete="organization" placeholder="Company or project" className={fieldCls} />
              </div>
              <div>
                <label htmlFor="teamSize" className="mb-1.5 block text-sm font-medium">
                  Team size
                </label>
                <select id="teamSize" name="teamSize" defaultValue="" className={fieldCls}>
                  <option value="" disabled>
                    Select a range
                  </option>
                  <option value="1–10">1–10</option>
                  <option value="11–50">11–50</option>
                  <option value="51–200">51–200</option>
                  <option value="200+">200+</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="needs" className="mb-1.5 block text-sm font-medium">
                What would you like to see?
              </label>
              <textarea
                id="needs"
                name="needs"
                rows={3}
                placeholder="e.g. tender tracking, timeline slippage, milestone payments (optional)."
                className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 font-sans text-sm text-zinc-900 placeholder:text-zinc-600 outline-none transition focus:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400"
              />
            </div>
            <SubmitButton size="lg" className="h-12 w-full rounded-lg text-base sm:w-auto sm:px-10" pendingText="Sending…">
              Request your walkthrough
            </SubmitButton>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Already have an account?{' '}
              <Link href="/sign-in" className={`font-medium text-brand-700 hover:underline dark:text-brand-400 ${focusRing}`}>
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
    <section id="faq" className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        <h2 className="text-3xl font-medium tracking-[-0.015em] sm:text-4xl">Questions, answered.</h2>
        <div className="mt-10 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {FAQS.map(({ q, a }) => (
            <details key={q} className="group py-5">
              <summary className={`flex cursor-pointer list-none items-baseline justify-between gap-4 text-left text-lg font-medium ${focusRing}`}>
                {q}
                <span className="text-zinc-400 transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-[62ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
