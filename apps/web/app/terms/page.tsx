import Link from 'next/link';
import type { Metadata } from 'next';
import { DraftNotice } from '@/components/legal/draft-notice';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms governing your use of DatumPro — accounts, subscription and pricing, acceptable use, your data, liability and termination.',
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-20 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</p>;
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <DraftNotice />

      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Legal</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Last updated: {LEGAL.lastUpdated}</p>

      <P>
        These Terms of Service (“Terms”) are an agreement between you and {LEGAL.legalEntity}
        (“{LEGAL.product}”, “we”, “us”) and govern your access to and use of the {LEGAL.product} website
        and application (the “Service”). By creating an account or using the Service, you agree to these
        Terms. If you are entering into these Terms on behalf of an organisation, you confirm you have
        authority to bind that organisation.
      </P>

      <H2 id="service">1. The Service</H2>
      <P>
        {LEGAL.product} is a project-management platform for planning work, coordinating teams and
        contractors, running tenders, and tracking approvals and payments with an audit trail. We may
        add, change or remove features over time to improve the Service.
      </P>

      <H2 id="accounts">2. Accounts &amp; eligibility</H2>
      <P>
        You must provide accurate account information and keep your credentials confidential. You are
        responsible for activity under your account. An organisation’s owner and admins are responsible
        for managing their members’ access and for the members’ use of the Service. You must be at
        least 18 and use the Service for legitimate business purposes.
      </P>

      <H2 id="subscription">3. Subscription, pricing &amp; free trial</H2>
      <P>
        The Service is offered on a subscription basis at {LEGAL.pricing}. New organisations receive a
        free trial for {LEGAL.freeTrialMonths === 3 ? 'the first three (3) months' : `the first ${LEGAL.freeTrialMonths} months`};
        after the trial, the subscription fee applies unless you cancel. Fees are exclusive of any taxes
        or duties, which are your responsibility where applicable. Unless stated otherwise, fees are
        non-refundable except as required by law. We will give reasonable notice of price changes.
      </P>

      <H2 id="acceptable-use">4. Acceptable use</H2>
      <P>
        You agree not to: break the law or infringe others’ rights; upload malware or attempt to
        disrupt, probe or gain unauthorised access to the Service or other organisations’ data;
        misrepresent your identity or authority; scrape or overload the Service; or use it to store or
        transmit content you have no right to. We may investigate and act on violations, including
        suspension.
      </P>

      <H2 id="your-data">5. Your data &amp; ownership</H2>
      <P>
        As between you and us, your organisation owns the content it puts into the Service. You grant us
        a limited licence to host, process and display that content solely to operate and support the
        Service. We handle personal information as described in our{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link>. You are responsible for
        having the rights and any consents needed for the content you upload.
      </P>

      <H2 id="confidentiality">6. Confidentiality of tenders</H2>
      <P>
        The Service supports sealed tenders and competing quotes. You agree to use confidential
        information you access through the Service only for its intended purpose, and we design the
        Service so that sealed submissions are not disclosed to other bidders before the appropriate
        stage. You must not attempt to circumvent these controls.
      </P>

      <H2 id="availability">7. Availability &amp; warranties</H2>
      <P>
        We work to keep the Service available and reliable but do not guarantee uninterrupted or
        error-free operation. To the fullest extent permitted by law, the Service is provided “as is”
        and “as available”, without warranties of any kind, whether express or implied, including
        merchantability, fitness for a particular purpose and non-infringement.
      </P>

      <H2 id="liability">8. Limitation of liability</H2>
      <P>
        To the fullest extent permitted by law, neither party is liable for indirect, incidental,
        special, consequential or punitive damages, or for lost profits, revenue or data. Our total
        liability arising out of or relating to the Service is limited to the amount you paid us for the
        Service in the twelve (12) months before the event giving rise to the claim. Nothing in these
        Terms excludes liability that cannot be excluded by law.
      </P>

      <H2 id="termination">9. Suspension &amp; termination</H2>
      <P>
        You may stop using the Service and close your account at any time. We may suspend or terminate
        access if you materially breach these Terms, fail to pay fees, or use the Service in a way that
        risks harm to others or to the Service. On termination, your right to use the Service ends; we
        will make your organisation’s content available for export for a reasonable period where
        practicable, after which it may be deleted per our{' '}
        <Link href="/privacy#retention" className="underline">retention</Link> practices.
      </P>

      <H2 id="changes">10. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. We will revise the “Last updated” date and, for
        material changes, take reasonable steps to notify you. Continued use after changes take effect
        means you accept the updated Terms.
      </P>

      <H2 id="governing-law">11. Governing law</H2>
      <P>
        These Terms are governed by the laws of {LEGAL.governingLaw}, without regard to conflict-of-law
        rules, and the courts of {LEGAL.governingLaw} have jurisdiction over disputes, unless mandatory
        law in your location provides otherwise.
      </P>

      <H2 id="contact">12. Contact</H2>
      <P>
        {LEGAL.legalEntity} · Registration {LEGAL.registrationNumber} · {LEGAL.registeredAddress}.
        Questions:{' '}
        <a href={`mailto:${LEGAL.supportEmail}`} className="underline">{LEGAL.supportEmail}</a>.
      </P>

      <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
        See also our <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </main>
  );
}
