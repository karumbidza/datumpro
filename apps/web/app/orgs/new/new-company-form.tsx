'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createOrg } from '../actions';
import { inputClass, labelClass, hintClass } from '@/components/ui/form';
import { Button } from '@/components/ui/button';

type Step = 'details' | 'verify';

const optionalLabel = (
  <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
);

/** Company setup wizard.
 *  Step 1 — the owner's name, the company profile, and a required Terms & Privacy
 *  acceptance. Step 2 — a 6-digit code sent to the signed-in email confirms the
 *  address before the company is created (skipped when the email is already
 *  confirmed). On success the server action redirects to the done screen. */
export function NewCompanyForm({
  loginEmail,
  emailConfirmed,
  personalEmail,
}: {
  loginEmail: string;
  emailConfirmed: boolean;
  personalEmail: boolean;
}) {
  const [step, setStep] = useState<Step>('details');

  // Step 1 fields
  const [fullName, setFullName] = useState('');
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [legalName, setLegalName] = useState('');
  const [country, setCountry] = useState('');
  const [sector, setSector] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [terms, setTerms] = useState(false);

  // Step 2
  const [code, setCode] = useState('');

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  function payload() {
    return {
      name: name.trim(),
      fullName: fullName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim(),
      legalName: legalName.trim(),
      country: country.trim(),
      sector: sector.trim(),
      registrationNumber: registrationNumber.trim(),
      termsAccepted: true as const,
    };
  }

  /** Create the org (server-side re-validates the email is confirmed + terms). */
  async function submit() {
    setBusy(true);
    setMessage(null);
    const res = await createOrg(payload());
    // Success redirects server-side; only a failure returns here.
    setBusy(false);
    if (res?.error) setMessage({ kind: 'error', text: res.error });
  }

  /** Validate step 1, then either create straight away (email already confirmed)
   *  or send a verification code and move to step 2. */
  async function continueFromDetails(e: React.FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) return setMessage({ kind: 'error', text: 'Enter your full name.' });
    if (name.trim().length < 2) return setMessage({ kind: 'error', text: 'Enter your company name.' });
    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()))
      return setMessage({ kind: 'error', text: 'Enter a valid company email, or leave it blank.' });
    if (!terms)
      return setMessage({ kind: 'error', text: 'Accept the Terms and Privacy Policy to continue.' });

    if (emailConfirmed) return submit(); // already verified at signup — no OTP needed

    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: loginEmail,
      options: { shouldCreateUser: false },
    });
    setBusy(false);
    if (error) {
      return setMessage({
        kind: 'error',
        text: /rate|seconds|too many/i.test(error.message)
          ? 'Wait a moment before requesting another code — the previous one is still valid.'
          : error.message,
      });
    }
    setMessage({ kind: 'info', text: `We sent a 6-digit code to ${loginEmail}.` });
    setStep('verify');
  }

  async function resend() {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email: loginEmail, options: { shouldCreateUser: false } });
    setBusy(false);
    setMessage(
      error
        ? { kind: 'error', text: 'Wait a moment before requesting another code.' }
        : { kind: 'info', text: `A new code is on its way to ${loginEmail}.` },
    );
  }

  /** Verify the code (confirms email_confirmed_at), then create the org. */
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    const token = code.trim();
    if (token.length < 6) return setMessage({ kind: 'error', text: 'Enter the 6-digit code from your email.' });
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: loginEmail, token, type: 'email' });
    if (error) {
      setBusy(false);
      return setMessage({
        kind: 'error',
        text: /expired/i.test(error.message)
          ? 'That code is no longer valid — codes are single-use and a resend replaces older ones. Use the code from the newest email.'
          : 'That code is incorrect. Check the newest email, or resend.',
      });
    }
    await submit(); // keeps the spinner up through creation + redirect
  }

  const notice = message && (
    <p
      className={`mt-4 text-sm ${
        message.kind === 'error' ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-300'
      }`}
    >
      {message.text}
    </p>
  );

  if (step === 'verify') {
    return (
      <>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">
          Step 2 of 2 · Verify email
        </p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Confirm your email</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Enter the 6-digit code we sent to <span className="font-medium text-zinc-700 dark:text-zinc-300">{loginEmail}</span>.
        </p>

        <form onSubmit={verify} className="mt-6 space-y-3">
          <div>
            <label htmlFor="code" className={labelClass}>
              Verification code
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className={`${inputClass} tracking-[0.4em]`}
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Verifying…' : 'Verify & create company'}
          </Button>
        </form>

        <div className="mt-4 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => {
              setStep('details');
              setCode('');
              setMessage(null);
            }}
            className="text-zinc-500 dark:text-zinc-400 hover:underline"
          >
            ← Back to details
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={busy}
            className="font-medium text-brand-600 dark:text-brand-400 hover:underline disabled:opacity-50"
          >
            Resend code
          </button>
        </div>

        {notice}
      </>
    );
  }

  return (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-brand-600 dark:text-brand-400">
        Step 1 of 2 · Your company
      </p>
      <h1 className="mt-1 text-lg font-semibold tracking-tight">Set up your company</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        This is your tenant — you&apos;ll be the owner. A short profile keeps your workspace on record and credible for
        the teams and clients you invite.
      </p>

      {personalEmail && (
        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          You&apos;re signed in with a personal email. A work address (you@yourcompany.com) looks more credible to the
          teams and clients you&apos;ll invite — but you can continue either way.
        </p>
      )}

      <form onSubmit={continueFromDetails} className="mt-6 space-y-3">
        <div>
          <label htmlFor="fullName" className={labelClass}>
            Your full name
          </label>
          <input
            id="fullName"
            required
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ada Lovelace"
            className={inputClass}
          />
          <p className={hintClass}>Shown across the app — on tasks, chat and your team roster.</p>
        </div>

        <div>
          <label htmlFor="name" className={labelClass}>
            Company name
          </label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Construction"
            className={inputClass}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="contactEmail" className={labelClass}>
              Company email {optionalLabel}
            </label>
            <input
              id="contactEmail"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="hello@acme.com"
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label htmlFor="contactPhone" className={labelClass}>
              Company phone {optionalLabel}
            </label>
            <input
              id="contactPhone"
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+263 …"
              className={inputClass}
            />
          </div>
        </div>

        <details className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <summary className="cursor-pointer text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Registration details (optional)
          </summary>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="legalName" className={labelClass}>
                Legal / registered name {optionalLabel}
              </label>
              <input
                id="legalName"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="e.g. Acme Construction (Private) Limited"
                className={inputClass}
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="country" className={labelClass}>
                  Country {optionalLabel}
                </label>
                <input
                  id="country"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g. Zimbabwe"
                  className={inputClass}
                />
              </div>
              <div className="flex-1">
                <label htmlFor="sector" className={labelClass}>
                  Sector {optionalLabel}
                </label>
                <select id="sector" value={sector} onChange={(e) => setSector(e.target.value)} className={inputClass}>
                  <option value="">Select…</option>
                  <option value="construction">Construction</option>
                  <option value="corporate">Corporate / Private</option>
                  <option value="ngo">NGO / Non-profit</option>
                  <option value="government">Government</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="registrationNumber" className={labelClass}>
                Registration number {optionalLabel}
              </label>
              <input
                id="registrationNumber"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                placeholder="Company / entity reg. number"
                className={inputClass}
              />
            </div>
          </div>
        </details>

        <label className="flex items-start gap-2.5 pt-1 text-sm text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-none rounded border-zinc-300 text-brand-600 focus:ring-brand-500 dark:border-zinc-600 dark:bg-zinc-900"
          />
          <span>
            I agree to the{' '}
            <a href="/terms" target="_blank" className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy" target="_blank" className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
              Privacy Policy
            </a>
            .
          </span>
        </label>

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Working…' : emailConfirmed ? 'Create company' : 'Continue'}
        </Button>
      </form>

      {notice}
    </>
  );
}
