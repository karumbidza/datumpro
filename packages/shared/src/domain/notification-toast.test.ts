import { describe, it, expect } from 'vitest';
import {
  notificationRowToToast,
  enqueueToast,
  toastAccent,
  MAX_VISIBLE_TOASTS,
  type ToastModel,
  type NotificationRow,
} from './notification-toast';

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: 'n1',
  org_id: 'orgA',
  type: 'task_assigned',
  title: 'New task',
  body: 'Do the thing',
  link: '/projects/1/tasks',
  ...over,
});

const orgs = { orgA: { name: 'Acme' }, orgB: { name: 'Quillstone' } };

describe('notificationRowToToast', () => {
  it('maps a snake_case row to a toast and resolves the org name', () => {
    expect(notificationRowToToast(row(), orgs)).toEqual({
      id: 'n1',
      orgId: 'orgA',
      orgName: 'Acme',
      title: 'New task',
      body: 'Do the thing',
      link: '/projects/1/tasks',
      type: 'task_assigned',
    });
  });

  it('falls back to a null org name for an unknown org', () => {
    expect(notificationRowToToast(row({ org_id: 'ghost' }), orgs).orgName).toBeNull();
  });
});

describe('enqueueToast', () => {
  const mk = (id: string): ToastModel => ({
    id, orgId: 'orgA', orgName: 'Acme', title: id, body: null, link: null, type: 't',
  });

  it('prepends newest-first', () => {
    const s = enqueueToast(enqueueToast([], mk('a')), mk('b'));
    expect(s.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('dedupes by id and returns the same array reference', () => {
    const s1 = enqueueToast([], mk('a'));
    expect(enqueueToast(s1, mk('a'))).toBe(s1);
  });
});

describe('toastAccent', () => {
  it('maps type prefixes to accent colours', () => {
    expect(toastAccent('approval_request')).toBe('amber');
    expect(toastAccent('payment_anticipated')).toBe('green');
    expect(toastAccent('retention_release_scheduled')).toBe('green');
    expect(toastAccent('tender_awarded')).toBe('blue');
    expect(toastAccent('task_assigned')).toBe('neutral');
  });
});

describe('MAX_VISIBLE_TOASTS', () => {
  it('caps the visible stack at 3', () => {
    expect(MAX_VISIBLE_TOASTS).toBe(3);
  });
});
