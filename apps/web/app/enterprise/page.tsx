import Link from 'next/link';
import { submitEnterpriseRequest } from './actions';
import { Card } from '@/components/ui/card';
import { SubmitButton } from '@/components/ui/submit-button';

export const metadata = { title: 'Government & Enterprise — DatumPro' };

const inputClass =
  'w-full rounded-md border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-zinc-800';

const assurances: { title: string; body: string }[] = [
  {
    title: 'Data isolation & access control',
    body: 'Every organisation is a separate tenant, enforced at the database with row-level security. Role separation keeps money actions, approvals, and delivery in the right hands.',
  },
  {
    title: 'Named accountability & audit',
    body: 'A named owner, a member roster, and a tamper-evident audit log of consequential actions — the trail procurement and auditors ask for.',
  },
  {
    title: 'Data residency & handling',
    body: 'Encryption in transit and at rest on managed cloud infrastructure. Tell us your residency and sovereignty requirements and we’ll confirm region and handling before you onboard.',
  },
  {
    title: 'Enterprise sign-in (on request)',
    body: 'MFA can be enforced org-wide today. SSO / SAML with your identity provider is available for enterprise and government deployments — mention it below.',
  },
];

export default async function EnterprisePage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Government &amp; enterprise</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">DatumPro for larger organisations</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        For corporates, construction firms, NGOs, and government teams with procurement, identity, and
        data-handling requirements. Tell us what you need and we’ll set you up.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {assurances.map((a) => (
          <Card key={a.title}>
            <h2 className="text-sm font-semibold">{a.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{a.body}</p>
          </Card>
        ))}
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold tracking-tight">Request access</h2>
        {sent ? (
          <Card className="mt-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-200">
              Thanks — we’ve received your request and a member of the DatumPro team will be in touch shortly.
            </p>
            <Link href="/sign-in" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
              Back to sign in →
            </Link>
          </Card>
        ) : (
          <Card className="mt-3">
            {error && (
              <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
                {decodeURIComponent(error)}
              </p>
            )}
            <form action={submitEnterpriseRequest} className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Organisation</label>
                  <input name="orgName" required placeholder="e.g. Ministry of Public Works" className={inputClass} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Buyer type</label>
                  <select name="buyerType" defaultValue="" className={inputClass}>
                    <option value="">Select…</option>
                    <option value="government">Government</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="ngo">NGO</option>
                    <option value="corporate">Corporate</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Your name</label>
                  <input name="contactName" placeholder="Full name" className={inputClass} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Work email</label>
                  <input name="contactEmail" type="email" required placeholder="you@org.gov" className={inputClass} />
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Country</label>
                  <input name="country" placeholder="e.g. Zimbabwe" className={inputClass} />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium">Team size</label>
                  <input name="teamSize" placeholder="e.g. 50–200" className={inputClass} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  What do you need? <span className="text-zinc-400">(SSO, residency, timelines…)</span>
                </label>
                <textarea name="needs" rows={3} className={inputClass} />
              </div>
              <SubmitButton className="w-full" pendingText="Sending…">
                Request access
              </SubmitButton>
            </form>
          </Card>
        )}
      </div>

      <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
        Prefer to read about security first?{' '}
        <Link href="/security" className="underline">
          How we protect your data
        </Link>
        .
      </p>
    </main>
  );
}
