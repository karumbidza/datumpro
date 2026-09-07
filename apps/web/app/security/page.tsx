import Link from 'next/link';
import { MarketingShell, focusRing } from '@/components/marketing/chrome';

export const metadata = { title: 'Security & Data — DatumPro' };

const points: { id: string; title: string; body: string }[] = [
  {
    id: 'isolation',
    title: 'Your data is isolated per organisation',
    body: 'Every company is a separate tenant. Access is enforced at the database with row-level security on each record — not just hidden in the UI. One organisation can never read another’s data.',
  },
  {
    id: 'roles',
    title: 'Role-based access and separation of duties',
    body: 'Owners, admins, finance, project managers and members each get exactly the access their role needs. Money actions and approvals are deliberately separated so no single person can both raise and approve spend.',
  },
  {
    id: 'accountability',
    title: 'Named accountability',
    body: 'Every organisation has a named owner and a member roster. Invitations are tied to a specific email address, so you always know who has access and who invited them.',
  },
  {
    id: 'residency',
    title: 'Where your data lives',
    body: 'DatumPro runs on managed cloud infrastructure with encryption in transit and at rest. For government and enterprise buyers with data-residency requirements, get in touch — we’ll confirm region and handling.',
  },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <h1 className="max-w-[18ch] text-4xl font-medium leading-[1.08] tracking-[-0.02em] sm:text-5xl" style={{ textWrap: 'balance' }}>
          How DatumPro protects your organisation.
        </h1>
        <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          Built for corporates, construction firms, NGOs and government teams that need their data handled with care.
        </p>

        <div className="mt-14 max-w-3xl">
          {points.map((p, i) => (
            <section key={p.id} id={p.id} className={`scroll-mt-20 py-8 ${i > 0 ? 'border-t border-zinc-200 dark:border-zinc-800' : ''}`}>
              <h2 className="text-2xl font-medium tracking-[-0.015em]">{p.title}</h2>
              <p className="mt-3 max-w-[62ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{p.body}</p>
            </section>
          ))}
        </div>

        <p className="mt-10 max-w-[58ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Security question or procurement requirement?{' '}
          <Link href="/enterprise" className={`font-medium text-brand-700 hover:underline dark:text-brand-400 ${focusRing}`}>
            Get in touch
          </Link>
          .
        </p>
      </div>
    </MarketingShell>
  );
}
