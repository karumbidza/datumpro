import { describe, it, expect } from 'vitest';
import { createOrgSchema, orgSetupSchema } from './index';

describe('createOrgSchema — company profile', () => {
  it('accepts a full profile', () => {
    const r = createOrgSchema.safeParse({
      name: 'Grafaid Engineers',
      legalName: 'Grafaid Engineers Ltd',
      country: 'KE',
      sector: 'construction',
      registrationNumber: 'PVT-12345',
    });
    expect(r.success).toBe(true);
  });

  it('requires name (min 2) but allows optional profile fields to be blank', () => {
    const r = createOrgSchema.safeParse({ name: 'AB' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.legalName).toBeUndefined();
      expect(r.data.registrationNumber).toBeUndefined();
    }
  });

  it('rejects a too-short name', () => {
    expect(createOrgSchema.safeParse({ name: 'A' }).success).toBe(false);
  });

  it('normalises empty optional strings to undefined', () => {
    const r = createOrgSchema.safeParse({ name: 'Acme', legalName: '   ', country: '' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.legalName).toBeUndefined();
      expect(r.data.country).toBeUndefined();
    }
  });

  it('accepts an optional company contact email/phone, rejecting a malformed email', () => {
    const ok = createOrgSchema.safeParse({ name: 'Acme', contactEmail: 'hello@acme.co', contactPhone: '+263 77 000 0000' });
    expect(ok.success).toBe(true);
    const blank = createOrgSchema.safeParse({ name: 'Acme', contactEmail: '' });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.contactEmail).toBeUndefined();
    expect(createOrgSchema.safeParse({ name: 'Acme', contactEmail: 'not-an-email' }).success).toBe(false);
  });
});

describe('orgSetupSchema — full setup wizard payload', () => {
  it('accepts a valid payload with owner name and accepted terms', () => {
    const r = orgSetupSchema.safeParse({ name: 'Acme', fullName: 'Ada Lovelace', termsAccepted: true });
    expect(r.success).toBe(true);
  });

  it('requires the owner full name', () => {
    expect(orgSetupSchema.safeParse({ name: 'Acme', fullName: 'A', termsAccepted: true }).success).toBe(false);
  });

  it('requires terms to be accepted (true)', () => {
    expect(orgSetupSchema.safeParse({ name: 'Acme', fullName: 'Ada Lovelace' }).success).toBe(false);
    expect(orgSetupSchema.safeParse({ name: 'Acme', fullName: 'Ada Lovelace', termsAccepted: false }).success).toBe(false);
  });
});
