import { describe, it, expect } from 'vitest';
import { isBusinessEmail, PERSONAL_EMAIL_DOMAINS } from './email';

describe('isBusinessEmail — work-email nudge for org creation', () => {
  it('accepts company domains', () => {
    expect(isBusinessEmail('allen@grafaid.co.ke')).toBe(true);
    expect(isBusinessEmail('pm@acme-construction.com')).toBe(true);
  });

  it('rejects common free/personal providers', () => {
    expect(isBusinessEmail('someone@gmail.com')).toBe(false);
    expect(isBusinessEmail('someone@yahoo.com')).toBe(false);
    expect(isBusinessEmail('someone@outlook.com')).toBe(false);
    expect(isBusinessEmail('someone@hotmail.com')).toBe(false);
    expect(isBusinessEmail('someone@icloud.com')).toBe(false);
  });

  it('is case-insensitive and trims', () => {
    expect(isBusinessEmail('  Someone@GMAIL.com ')).toBe(false);
    expect(isBusinessEmail('Owner@Grafaid.CO.KE')).toBe(true);
  });

  it('treats malformed input as not a business email', () => {
    expect(isBusinessEmail('')).toBe(false);
    expect(isBusinessEmail('no-at-sign')).toBe(false);
    expect(isBusinessEmail('trailing@')).toBe(false);
  });

  it('exposes the blocklist as a tunable constant', () => {
    expect(PERSONAL_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
  });
});
