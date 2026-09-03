'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function RequestAccessPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const data = {
      orgName: formData.get('orgName'),
      contactName: formData.get('contactName'),
      contactEmail: formData.get('contactEmail'),
      phone: formData.get('phone'),
      teamSize: formData.get('teamSize'),
      planTier: formData.get('planTier'),
      needs: formData.get('needs'),
    };

    try {
      const res = await fetch('/api/request-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Failed to submit request');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-6 sm:p-12">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-white">
          <span className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center font-black">D</span>
          DatumPro
        </Link>
        <Link href="/sign-in" className="text-xs text-slate-400 hover:text-white transition-colors">
          Already have an account? <span className="text-indigo-400 underline">Sign in</span>
        </Link>
      </header>

      <main className="max-w-2xl w-full mx-auto my-12">
        {submitted ? (
          <div className="bg-slate-900 border border-emerald-500/30 rounded-2xl p-8 text-center space-y-4">
            <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">Access Request Received</h1>
            <p className="text-sm text-slate-300 max-w-md mx-auto">
              Our sales &amp; onboarding team has received your organization details. We will review your requirements and send a custom onboarding link &amp; invitation directly to your email.
            </p>
            <div className="pt-4">
              <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-400 hover:underline">
                Return to Homepage &rarr;
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-xs font-medium border border-indigo-500/20">
                Managed Enterprise Onboarding
              </span>
              <h1 className="text-3xl font-extrabold text-white tracking-tight mt-3">
                Request Access for Your Organization
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Fill in your company details. Our onboarding team will configure your workspace and issue your direct activation link.
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Company / Organization Name *
                  </label>
                  <input
                    type="text"
                    name="orgName"
                    required
                    placeholder="e.g. Apex Construction Ltd"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Contact Person Name *
                  </label>
                  <input
                    type="text"
                    name="contactName"
                    required
                    placeholder="e.g. Sarah Jenkins"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Work Email Address *
                  </label>
                  <input
                    type="email"
                    name="contactEmail"
                    required
                    placeholder="s.jenkins@apexconstruction.com"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Phone / WhatsApp Number
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    placeholder="+263 77 000 0000"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Estimated Team / Seat Count
                  </label>
                  <select
                    name="teamSize"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  >
                    <option value="1-10">1 - 10 members</option>
                    <option value="10-50">10 - 50 members</option>
                    <option value="50-200">50 - 200 members</option>
                    <option value="200+">200+ Enterprise</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Preferred Tier
                  </label>
                  <select
                    name="planTier"
                    className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500"
                  >
                    <option value="Standard">Standard ($120/mo)</option>
                    <option value="Enterprise">Enterprise Custom</option>
                    <option value="Trial">Managed 30-Day Trial</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Project Delivery &amp; Finance Needs
                </label>
                <textarea
                  name="needs"
                  rows={3}
                  placeholder="Tell us briefly about your active projects or specific BOQ/tender requirements..."
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3.5 py-2 text-sm text-white outline-none focus:border-indigo-500 resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 text-sm transition-colors flex items-center justify-center gap-2"
              >
                {loading ? 'Submitting Request...' : 'Submit Request for Sales Review &rarr;'}
              </button>
            </form>
          </div>
        )}
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-slate-500">
        &copy; {new Date().getFullYear()} DatumPro &middot; Managed Onboarding
      </footer>
    </div>
  );
}
