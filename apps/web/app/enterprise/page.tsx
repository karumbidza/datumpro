import Link from 'next/link';
import { submitEnterpriseRequest } from './actions';
import { MarketingShell, focusRing } from '@/components/marketing/chrome';
import { SubmitButton } from '@/components/ui/submit-button';

export const metadata = { title: 'Government & Enterprise — DatumPro' };

const fieldCls =
  'h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 font-sans text-sm text-zinc-900 placeholder:text-zinc-600 outline-none transition focus:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400';

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
    <MarketingShell>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <h1 className="max-w-[18ch] text-4xl font-medium leading-[1.08] tracking-[-0.02em] sm:text-5xl" style={{ textWrap: 'balance' }}>
          DatumPro for larger organisations.
        </h1>
        <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
          For corporates, construction firms, NGOs and government teams with procurement, identity, and data-handling
          requirements. Tell us what you need and we&rsquo;ll set you up.
        </p>

        <div className="mt-14 max-w-3xl">
          {assurances.map((a, i) => (
            <section key={a.title} className={`py-7 ${i > 0 ? 'border-t border-zinc-200 dark:border-zinc-800' : ''}`}>
              <h2 className="text-xl font-medium tracking-[-0.01em]">{a.title}</h2>
              <p className="mt-2 max-w-[62ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">{a.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-16 max-w-3xl border-t border-zinc-200 pt-12 dark:border-zinc-800" id="request">
          <h2 className="text-2xl font-medium tracking-[-0.015em] sm:text-3xl">Request access.</h2>
          {sent ? (
            <div className="mt-5">
              <p className="max-w-[58ch] text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                Thanks — we&rsquo;ve received your request and a member of the DatumPro team will be in touch shortly.
              </p>
              <Link href="/sign-in" className={`mt-4 inline-block text-[17px] font-medium text-brand-700 hover:underline dark:text-brand-400 ${focusRing}`}>
                Back to sign in →
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <p role="alert" className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 font-sans text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
                  {decodeURIComponent(error)}
                </p>
              )}
              <form action={submitEnterpriseRequest} className="mt-7 space-y-5">
                {/* Honeypot (spam trap): hidden from real users; bots that
                    auto-fill every field will populate it and the server
                    silently drops the submission. Not display:none so headless
                    crawlers that skip hidden inputs still see it. */}
                <div aria-hidden className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden" data-hp>
                  <label>
                    Website
                    <input name="website" type="text" tabIndex={-1} autoComplete="off" />
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="orgName" className="mb-1.5 block text-sm font-medium">
                      Organisation <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
                    </label>
                    <input id="orgName" name="orgName" required className={fieldCls} />
                  </div>
                  <div>
                    <label htmlFor="buyerType" className="mb-1.5 block text-sm font-medium">
                      Buyer type
                    </label>
                    <select id="buyerType" name="buyerType" defaultValue="" className={fieldCls}>
                      <option value="">Select…</option>
                      <option value="government">Government</option>
                      <option value="enterprise">Enterprise</option>
                      <option value="ngo">NGO</option>
                      <option value="corporate">Corporate</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="contactName" className="mb-1.5 block text-sm font-medium">
                      Your name
                    </label>
                    <input id="contactName" name="contactName" className={fieldCls} />
                  </div>
                  <div>
                    <label htmlFor="contactEmail" className="mb-1.5 block text-sm font-medium">
                      Work email <span aria-hidden className="text-red-600 dark:text-red-400">*</span>
                    </label>
                    <input id="contactEmail" name="contactEmail" type="email" required placeholder="you@org.gov" className={fieldCls} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="country" className="mb-1.5 block text-sm font-medium">
                      Country
                    </label>
                    <input id="country" name="country" className={fieldCls} />
                  </div>
                  <div>
                    <label htmlFor="teamSize" className="mb-1.5 block text-sm font-medium">
                      Team size
                    </label>
                    <input id="teamSize" name="teamSize" placeholder="e.g. 50–200" className={fieldCls} />
                  </div>
                </div>
                <div>
                  <label htmlFor="needs" className="mb-1.5 block text-sm font-medium">
                    What do you need? <span className="text-zinc-600 dark:text-zinc-400">(SSO, residency, timelines…)</span>
                  </label>
                  <textarea
                    id="needs"
                    name="needs"
                    rows={3}
                    className="w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 font-sans text-sm text-zinc-900 placeholder:text-zinc-600 outline-none transition focus:border-brand-600 focus-visible:ring-2 focus-visible:ring-brand-600/25 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400"
                  />
                </div>
                <SubmitButton className="h-12 w-full rounded-lg text-base sm:w-auto sm:px-10" pendingText="Sending…">
                  Request access
                </SubmitButton>
              </form>
            </>
          )}
        </div>

        <p className="mt-12 text-[17px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Prefer to read about security first?{' '}
          <Link href="/security" className={`font-medium text-brand-700 hover:underline dark:text-brand-400 ${focusRing}`}>
            How we protect your data
          </Link>
          .
        </p>
      </div>
    </MarketingShell>
  );
}
