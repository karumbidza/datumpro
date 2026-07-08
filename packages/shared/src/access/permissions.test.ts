import { describe, it, expect } from 'vitest';
import { can } from './permissions';

describe('permissions — segregation of duties', () => {
  it('finance can move money but cannot approve variations or requests', () => {
    expect(can('finance', 'invoice:create')).toBe(true);
    expect(can('finance', 'payment:record')).toBe(true);
    expect(can('finance', 'pop:verify')).toBe(true);
    expect(can('finance', 'variation:approve')).toBe(false);
    expect(can('finance', 'request:approve')).toBe(false);
  });

  it('pm runs delivery + approvals but cannot record payments or send invoices', () => {
    expect(can('pm', 'request:approve')).toBe(true);
    expect(can('pm', 'variation:approve')).toBe(true);
    expect(can('pm', 'payment:record')).toBe(false);
    expect(can('pm', 'invoice:send')).toBe(false);
  });

  it('owner can do everything; viewer is read-only', () => {
    expect(can('owner', 'org:manage')).toBe(true);
    expect(can('owner', 'variation:approve')).toBe(true);
    expect(can('viewer', 'finance:view')).toBe(false);
    expect(can('viewer', 'invoice:create')).toBe(false);
    expect(can('viewer', 'report:create')).toBe(false);
  });

  it('members can capture fieldwork + submit POPs but not verify them', () => {
    expect(can('member', 'report:create')).toBe(true);
    expect(can('member', 'pop:submit')).toBe(true);
    expect(can('member', 'pop:verify')).toBe(false);
  });
});
