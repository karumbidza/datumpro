import { describe, it, expect } from 'vitest';
import { composeWorkPulse, timeOfDay, type WorkPulseData } from './work-pulse';

const base: WorkPulseData = {
  firstName: 'Allen',
  pendingApprovals: 0,
  overdueTasks: 0,
  dueTodayTasks: 0,
  dueSoonTasks: 0,
  upcomingTasks: 0,
  blockedTasks: 0,
  completedThisWeek: 0,
  recentActivityCount: 0,
  userRecentlyActive: false,
  overallProgressPct: null,
  activeProjectName: null,
  nextDeadlineIso: null,
};

const at = (h: number) => new Date(2026, 7, 30, h, 0, 0); // Aug 30 2026, local time

describe('timeOfDay', () => {
  it('maps hours to the right band', () => {
    expect(timeOfDay(at(6))).toBe('morning');
    expect(timeOfDay(at(11))).toBe('morning');
    expect(timeOfDay(at(12))).toBe('afternoon');
    expect(timeOfDay(at(16))).toBe('afternoon');
    expect(timeOfDay(at(17))).toBe('evening');
    expect(timeOfDay(at(21))).toBe('evening');
    expect(timeOfDay(at(22))).toBe('late');
    expect(timeOfDay(at(2))).toBe('late');
  });
});

describe('primary greeting', () => {
  it('uses the time of day and the first name', () => {
    expect(composeWorkPulse(base, at(9)).primary).toBe('Good morning, Allen');
    expect(composeWorkPulse(base, at(14)).primary).toBe('Good afternoon, Allen');
    expect(composeWorkPulse(base, at(19)).primary).toBe('Good evening, Allen');
  });

  it('only goes playful late at night when allowed AND the user is active', () => {
    const active = { ...base, userRecentlyActive: true };
    expect(composeWorkPulse(active, at(23), { allowPlayful: true }).primary).toBe('Burning the midnight oil, Allen?');
    // Not allowed, or user idle → plain evening greeting, no "still working?".
    expect(composeWorkPulse(active, at(23), { allowPlayful: false }).primary).toBe('Good evening, Allen');
    expect(composeWorkPulse(base, at(23), { allowPlayful: true }).primary).toBe('Good evening, Allen');
  });
});

describe('insight priority', () => {
  it('leads with overdue, then folds in the next attention item', () => {
    const d = { ...base, overdueTasks: 2, pendingApprovals: 3 };
    expect(composeWorkPulse(d, at(14)).insight).toBe(
      '2 tasks have slipped past their planned dates, and 3 approvals are waiting for you.',
    );
  });

  it('agrees in the singular', () => {
    expect(composeWorkPulse({ ...base, pendingApprovals: 1 }, at(14)).insight).toBe('1 approval is waiting for you.');
    expect(composeWorkPulse({ ...base, overdueTasks: 1 }, at(14)).insight).toBe(
      '1 task has slipped past its planned date.',
    );
  });

  it('falls to workload when nothing needs attention', () => {
    expect(composeWorkPulse({ ...base, upcomingTasks: 7 }, at(9)).insight).toBe(
      "You've got 7 tasks coming up this week.",
    );
  });

  it('is project-aware for workload when one project dominates', () => {
    const d = { ...base, upcomingTasks: 4, activeProjectName: 'Test Project' };
    expect(composeWorkPulse(d, at(9)).insight).toBe('Test Project has 4 tasks coming up this week.');
  });

  it('shows progress when there is no workload but progress is known', () => {
    expect(composeWorkPulse({ ...base, overallProgressPct: 38 }, at(14)).insight).toBe(
      'Things are moving — overall progress is at 38%.',
    );
  });

  it('falls all the way to a quiet message', () => {
    expect(composeWorkPulse(base, at(9)).insight).toMatch(/quiet|clear/i);
  });
});

describe('glance line', () => {
  it('summarises when there are at least two facts', () => {
    const d = { ...base, pendingApprovals: 1, upcomingTasks: 7, nextDeadlineIso: '2026-09-03' };
    expect(composeWorkPulse(d, at(14)).glance).toBe('1 approval · 7 upcoming · Next deadline Sep 3');
  });

  it('is omitted when there is only one fact', () => {
    expect(composeWorkPulse({ ...base, pendingApprovals: 1 }, at(14)).glance).toBeNull();
  });
});
