import Link from 'next/link';
import type { Metadata } from 'next';
import { DraftNotice } from '@/components/legal/draft-notice';
import { LEGAL, SUBPROCESSORS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How DatumPro collects, uses, shares and protects personal information, your rights, and how to contact us.',
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

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <DraftNotice />

      <p className="text-xs font-medium uppercase tracking-wide text-brand-600">Legal</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Last updated: {LEGAL.lastUpdated}</p>

      <P>
        This Privacy Policy explains how {LEGAL.legalEntity} (“{LEGAL.product}”, “we”, “us”) collects,
        uses, shares and protects personal information when you use the {LEGAL.product} website and
        application (the “Service”). We act as the responsible party / data controller for information
        about your account, and as an operator / processor for the content your organisation stores in
        the Service.
      </P>
      <P>
        We aim to comply with Zimbabwe’s Cyber and Data Protection Act, South Africa’s Protection of
        Personal Information Act (POPIA), and comparable data-protection laws; where you are protected
        by the EU/UK GDPR, the equivalent rights described below apply to you.
      </P>

      <H2 id="collect">1. Information we collect</H2>
      <P>
        <strong>Account &amp; profile.</strong> Your name, email address, and — if you provide them —
        phone number, profile photo and company name. When you create an organisation we also collect
        its legal name, country, sector and registration number.
      </P>
      <P>
        <strong>Content you put into the Service.</strong> Projects, tasks, schedules, comments,
        uploaded files and images, tender and quote information, and financial records such as payment
        requests, claims and approvals. This content belongs to your organisation; we process it to
        provide the Service.
      </P>
      <P>
        <strong>Technical &amp; usage data.</strong> IP address, device and browser information, and —
        only if you consent to analytics cookies — aggregated usage data (see{' '}
        <Link href="#cookies" className="underline">Cookies</Link>). We keep security and audit logs of
        key actions to protect your organisation’s data.
      </P>
      <P>
        <strong>Authentication.</strong> We process sign-in credentials through our authentication
        provider. The mobile app can send a one-time passcode by SMS to a phone number you provide.
      </P>

      <H2 id="use">2. How we use information</H2>
      <P>
        To provide, secure and maintain the Service; authenticate you and enforce access controls;
        send transactional messages (invitations, password resets, notifications); respond to support
        requests; detect, prevent and investigate abuse or security incidents; keep an audit trail for
        accountability; understand aggregate usage to improve the product (with your consent); and
        comply with legal obligations.
      </P>

      <H2 id="bases">3. Our legal bases</H2>
      <P>
        We rely on: performance of our contract with you (to deliver the Service); your consent (for
        analytics cookies and optional communications, which you may withdraw at any time); our
        legitimate interests (security, fraud prevention, and improving the Service, balanced against
        your rights); and compliance with legal obligations. Under POPIA these correspond to the
        conditions for lawful processing; under the GDPR, to Articles 6(1)(a), (b), (c) and (f).
      </P>

      <H2 id="cookies">4. Cookies &amp; analytics</H2>
      <P>
        <strong>Essential cookies</strong> are required to run the Service — for example to keep you
        signed in and to remember your active organisation. These are always on because the Service
        cannot function without them.
      </P>
      <P>
        <strong>Analytics cookies</strong> (Google Analytics) are <strong>off by default</strong> and
        load only after you select “Accept” in our cookie banner. Choose “Decline” and no analytics
        cookies are set and no analytics scripts are loaded. You can change your choice at any time via
        “Manage cookies” in the site footer.
      </P>

      <H2 id="sharing">5. Sharing &amp; sub-processors</H2>
      <P>
        We do not sell your personal information. We share it only with service providers who process
        it on our behalf under contract, and where required by law or to protect rights and safety. Our
        current sub-processors are:
      </P>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-semibold">Provider</th>
              <th className="py-2 font-semibold">Purpose</th>
            </tr>
          </thead>
          <tbody>
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                <td className="py-2 pr-4 font-medium text-zinc-800 dark:text-zinc-200">{s.name}</td>
                <td className="py-2 text-zinc-600 dark:text-zinc-300">{s.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H2 id="transfers">6. International transfers</H2>
      <P>
        Our providers may store and process data on servers outside your country. Where we transfer
        personal information across borders, we take steps intended to ensure it remains protected to a
        standard comparable to this policy and applicable law. If you have specific data-residency
        requirements, <Link href="/enterprise" className="underline">contact us</Link> — we’ll confirm
        region and handling.
      </P>

      <H2 id="retention">7. Retention</H2>
      <P>
        We keep personal information for as long as your account or organisation is active, and
        thereafter only as needed to comply with legal obligations, resolve disputes, and enforce our
        agreements. Organisation content is retained while the organisation exists; when it is deleted,
        content is removed or anonymised within a reasonable period, subject to backups and legal
        retention requirements.
      </P>

      <H2 id="security">8. Security</H2>
      <P>
        Your data is isolated per organisation and access is enforced in the database, not just the
        interface. We use encryption in transit and at rest through our infrastructure providers and
        keep an audit trail of key actions. Learn more on our{' '}
        <Link href="/security" className="underline">Security</Link> page. No system is perfectly
        secure, but we work to protect your information and to respond promptly to any incident.
      </P>

      <H2 id="rights">9. Your rights</H2>
      <P>
        Subject to applicable law, you may request access to the personal information we hold about
        you; correction of inaccurate information; deletion; restriction of or objection to certain
        processing; a copy of your information in a portable format; and withdrawal of consent where we
        rely on it. To exercise these rights, email{' '}
        <a href={`mailto:${LEGAL.privacyEmail}`} className="underline">{LEGAL.privacyEmail}</a>. You also
        have the right to lodge a complaint with your data-protection regulator — for example the
        Information Regulator (South Africa) or the data-protection authority in your country.
      </P>
      <P>
        Where your organisation administers your account, some requests may be directed to that
        organisation as the responsible party for its content.
      </P>

      <H2 id="children">10. Children</H2>
      <P>
        The Service is intended for business use and is not directed to children under 18. We do not
        knowingly collect personal information from children.
      </P>

      <H2 id="changes">11. Changes to this policy</H2>
      <P>
        We may update this policy from time to time. We will revise the “Last updated” date above and,
        for material changes, take reasonable steps to notify you.
      </P>

      <H2 id="contact">12. Contact us</H2>
      <P>
        {LEGAL.legalEntity} · Registration {LEGAL.registrationNumber} · {LEGAL.registeredAddress}.
        Privacy enquiries:{' '}
        <a href={`mailto:${LEGAL.privacyEmail}`} className="underline">{LEGAL.privacyEmail}</a>.
      </P>

      <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
        See also our <Link href="/terms" className="underline">Terms of Service</Link>.
      </p>
    </main>
  );
}
