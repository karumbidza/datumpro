import Link from 'next/link';
import type { Metadata } from 'next';
import { DraftNotice } from '@/components/legal/draft-notice';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description:
    'The terms governing your use of DatumPro — managed onboarding and access, custom subscription pricing, adding users, acceptable use, your data, liability and termination.',
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

      <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">Legal</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Last updated: {LEGAL.termsUpdated}</p>

      <P>
        These Terms of Service (“Terms”) are an agreement between you and {LEGAL.legalEntity}, which
        provides {LEGAL.product} through its {LEGAL.department} division (“{LEGAL.product}”, “we”, “us”),
        and govern your access to and use of the {LEGAL.product} website and application (the “Service”).
        By accessing or using the Service, you agree to these Terms. If a separate written agreement or
        order form is in place between us for the Service (a “Subscription Order”), that document and
        these Terms apply together; where they conflict, the Subscription Order governs. If you are
        entering into these Terms on behalf of an organisation, you confirm you have authority to bind
        that organisation.
      </P>

      <H2 id="service">1. The Service</H2>
      <P>
        {LEGAL.product} is a project-management platform for planning work, coordinating teams and
        contractors, running tenders, and tracking approvals and payments with an audit trail. We may
        add, change or remove features over time to improve the Service.
      </P>

      <H2 id="accounts">2. Accounts, onboarding &amp; eligibility</H2>
      <P>
        Access to {LEGAL.product} is provisioned by us for your organisation — there is no public
        self-service sign-up. After you request a demo and we agree to provide the Service, we set up
        your organisation’s account and its designated administrator. Your administrator manages members
        and their roles and is responsible for their access and use of the Service. You must provide
        accurate information, keep your credentials confidential, and are responsible for activity under
        your account. You must be at least 18 and use the Service for legitimate business purposes.
      </P>

      <H2 id="subscription">3. Subscription, pricing &amp; payment</H2>
      <P>
        The Service is provided on a subscription basis with {LEGAL.pricing}: pricing is agreed with your
        organisation in a written Subscription Order based on your scope, the features you use and the
        number of users — we do not publish a standard list price. Any trial, pilot or proof-of-value
        period applies only if and as agreed in writing in your Subscription Order. Fees are stated
        exclusive of taxes and duties, which are your responsibility where applicable. Unless your
        Subscription Order says otherwise, fees are invoiced in advance for the agreed term, payable by
        the due date on the invoice, and are non-refundable except as required by law. We may revise
        pricing for a renewal term on reasonable prior notice; a change does not affect the fees for a
        term already in progress.
      </P>

      <H2 id="users">4. Users, roles &amp; adding members</H2>
      <P>
        Your Subscription Order sets out the users, roles or seats included in your subscription. Your
        administrator may add or remove members at any time through the Service. Adding users or seats
        beyond your agreed allocation may increase your fees at the rate in your Subscription Order (or,
        if none is stated, our then-current rate), charged pro-rata for the remainder of the current term
        and reflected in your next invoice. Removing users does not reduce the fees for the current term
        unless your Subscription Order provides otherwise. Contractors, suppliers and clients you invite
        for limited, role-scoped access to specific tasks or projects are not counted as paid seats
        unless your Subscription Order states otherwise. You are responsible for the use of the Service by
        everyone you invite.
      </P>

      <H2 id="acceptable-use">5. Acceptable use</H2>
      <P>
        You agree not to: break the law or infringe others’ rights; upload malware or attempt to
        disrupt, probe or gain unauthorised access to the Service or other organisations’ data;
        misrepresent your identity or authority; scrape or overload the Service; or use it to store or
        transmit content you have no right to. We may investigate and act on violations, including
        suspension.
      </P>

      <H2 id="your-data">6. Your data &amp; ownership</H2>
      <P>
        As between you and us, your organisation owns the content it puts into the Service. You grant us
        a limited licence to host, process and display that content solely to operate and support the
        Service. We handle personal information as described in our{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link>. You are responsible for
        having the rights and any consents needed for the content you upload.
      </P>

      <H2 id="confidentiality">7. Confidentiality of tenders</H2>
      <P>
        The Service supports sealed tenders and competing quotes. You agree to use confidential
        information you access through the Service only for its intended purpose, and we design the
        Service so that sealed submissions are not disclosed to other bidders before the appropriate
        stage. You must not attempt to circumvent these controls.
      </P>

      <H2 id="availability">8. Availability &amp; warranties</H2>
      <P>
        We work to keep the Service available and reliable but do not guarantee uninterrupted or
        error-free operation. To the fullest extent permitted by law, the Service is provided “as is”
        and “as available”, without warranties of any kind, whether express or implied, including
        merchantability, fitness for a particular purpose and non-infringement.
      </P>

      <H2 id="liability">9. Limitation of liability</H2>
      <P>
        To the fullest extent permitted by law, neither party is liable for indirect, incidental,
        special, consequential or punitive damages, or for lost profits, revenue or data. Our total
        liability arising out of or relating to the Service is limited to the amount you paid us for the
        Service in the twelve (12) months before the event giving rise to the claim. Nothing in these
        Terms excludes liability that cannot be excluded by law.
      </P>

      <H2 id="termination">10. Suspension &amp; termination</H2>
      <P>
        You may stop using the Service and close your account at any time. We may suspend or terminate
        access if you materially breach these Terms, fail to pay fees, or use the Service in a way that
        risks harm to others or to the Service. On termination, your right to use the Service ends; we
        will make your organisation’s content available for export for a reasonable period where
        practicable, after which it may be deleted per our{' '}
        <Link href="/privacy#retention" className="underline">retention</Link> practices.
      </P>

      <H2 id="changes">11. Changes to these Terms</H2>
      <P>
        We may update these Terms from time to time. We will revise the “Last updated” date and, for
        material changes, take reasonable steps to notify you. Continued use after changes take effect
        means you accept the updated Terms.
      </P>

      <H2 id="governing-law">12. Governing law</H2>
      <P>
        These Terms are governed by the laws of {LEGAL.governingLaw}, without regard to conflict-of-law
        rules, and the courts of {LEGAL.governingLaw} have jurisdiction over disputes, unless mandatory
        law in your location provides otherwise.
      </P>

      <H2 id="contact">13. Contact</H2>
      <P>
        {LEGAL.legalEntity} · Registration {LEGAL.registrationNumber} · {LEGAL.registeredAddress} ·{' '}
        {LEGAL.phone}. Questions:{' '}
        <a href={`mailto:${LEGAL.supportEmail}`} className="underline">{LEGAL.supportEmail}</a>.
      </P>

      <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
        See also our <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </main>
  );
}
