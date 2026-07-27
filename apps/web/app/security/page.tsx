import Link from 'next/link';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'Security & Data — DatumPro' };

const points: { id: string; title: string; body: string }[] = [
  {
    id: 'isolation',
    title: 'Your data is isolated per organization',
    body: 'Every company is a separate tenant. Access is enforced at the database with row-level security on each record — not just hidden in the UI. One organization can never read another’s data.',
  },
  {
    id: 'roles',
    title: 'Role-based access & separation of duties',
    body: 'Owners, admins, finance, project managers and members each get exactly the access their role needs. Money actions and approvals are deliberately separated so no single person can both raise and approve spend.',
  },
  {
    id: 'accountability',
    title: 'Named accountability',
    body: 'Every organization has a named owner and a member roster. Invitations are tied to a specific email address, so you always know who has access and who invited them.',
  },
  {
    id: 'residency',
    title: 'Where your data lives',
    body: 'DatumPro runs on managed cloud infrastructure with encryption in transit and at rest. For government and enterprise buyers with data-residency requirements, get in touch — we’ll confirm region and handling.',
  },
];

export default function SecurityPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Trust &amp; security</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">How DatumPro protects your organization</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Built for corporates, construction firms, NGOs and government teams that need their data handled with care.
      </p>

      <div className="mt-8 space-y-4">
        {points.map((p) => (
          <div key={p.id} id={p.id} className="scroll-mt-20">
            <Card>
              <h2 className="text-base font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.body}</p>
            </Card>
          </div>
        ))}
      </div>

      <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
        Security question or procurement requirement?{' '}
        <Link href="/sign-in" className="underline">
          Get in touch
        </Link>
        .
      </p>
    </main>
  );
}
