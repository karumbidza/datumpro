import { describe, it, expect } from 'vitest';
import { createOrgSchema } from './index';

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
});
