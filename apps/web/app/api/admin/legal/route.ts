import { NextResponse } from 'next/server';
import { adapterAuthorized } from '@/lib/admin/adapter-auth';
import { LEGAL } from '@/lib/legal';

export const dynamic = 'force-dynamic';

export type LegalConfig = {
  operator: string;
  product: string;
  registrationNumber: string;
  registeredAddress: string;
  privacyEmail: string;
  supportEmail: string;
  governingLaw: string;
  lastUpdated: string;
  termsVersion: string;
};

// Mutable state in-memory for adapter updates
const legalState: LegalConfig = {
  operator: LEGAL.operator,
  product: LEGAL.product,
  registrationNumber: LEGAL.registrationNumber,
  registeredAddress: LEGAL.registeredAddress,
  privacyEmail: LEGAL.privacyEmail,
  supportEmail: LEGAL.supportEmail,
  governingLaw: LEGAL.governingLaw,
  lastUpdated: LEGAL.lastUpdated,
  termsVersion: 'v2.4',
};

/**
 * Legal & Terms Management endpoint for Mission Control (Pulse).
 * GET returns active terms metadata & entity facts.
 * POST allows Pulse operator to update terms metadata and last updated date.
 */
export async function GET(req: Request) {
  if (!adapterAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ legal: legalState });
}

export async function POST(req: Request) {
  if (!adapterAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<LegalConfig>;

  if (body.operator) legalState.operator = body.operator;
  if (body.registrationNumber) legalState.registrationNumber = body.registrationNumber;
  if (body.registeredAddress) legalState.registeredAddress = body.registeredAddress;
  if (body.privacyEmail) legalState.privacyEmail = body.privacyEmail;
  if (body.supportEmail) legalState.supportEmail = body.supportEmail;
  if (body.governingLaw) legalState.governingLaw = body.governingLaw;
  if (body.lastUpdated) legalState.lastUpdated = body.lastUpdated;
  if (body.termsVersion) legalState.termsVersion = body.termsVersion;

  return NextResponse.json({ ok: true, legal: legalState });
}
