import { describe, it, expect } from 'vitest';
import {
  computeSchedule,
  computeProgress,
  scheduleHealth,
  inclusiveDays,
  type SchedTask,
} from './scheduling';

const task = (id: string, durationDays: number, deps: [string, number][] = []): SchedTask => ({
  id,
  durationDays,
  status: 'todo',
  weight: durationDays,
  dependencies: deps.map(([predecessorId, lagDays]) => ({ predecessorId, lagDays })),
});

describe('computeSchedule', () => {
  it('lays out a simple chain with everything critical', () => {
    const r = computeSchedule([task('A', 2), task('B', 3, [['A', 0]]), task('C', 1, [['B', 0]])]);
    expect(r.hasCycle).toBe(false);
    expect(r.projectDurationDays).toBe(6);
    expect(r.tasks.A!.es).toBe(0);
    expect(r.tasks.B!.es).toBe(2);
    expect(r.tasks.C!.es).toBe(5);
    expect(r.criticalPath).toEqual(['A', 'B', 'C']);
  });

  it('gives a parallel non-critical branch positive float', () => {
    // A→B→D and A→C→D; the B branch is longer, so C carries slack.
    const r = computeSchedule([
      task('A', 1),
      task('B', 4, [['A', 0]]),
      task('C', 2, [['A', 0]]),
      task('D', 1, [['B', 0], ['C', 0]]),
    ]);
    expect(r.projectDurationDays).toBe(6);
    expect(r.tasks.C!.float).toBe(2);
    expect(r.tasks.C!.critical).toBe(false);
    expect(r.criticalPath).toEqual(['A', 'B', 'D']);
  });

  it('honours lag', () => {
    const r = computeSchedule([task('A', 1), task('B', 1, [['A', 2]])]);
    expect(r.tasks.B!.es).toBe(3); // finish A(1) + lag(2)
    expect(r.projectDurationDays).toBe(4);
  });

  it('reports a cycle instead of looping', () => {
    const r = computeSchedule([task('A', 1, [['B', 0]]), task('B', 1, [['A', 0]])]);
    expect(r.hasCycle).toBe(true);
    expect(r.criticalPath).toEqual([]);
  });
});

describe('computeProgress', () => {
  const now = new Date('2026-06-15T00:00:00Z');

  it('earns only verified (done) work, weighted', () => {
    const tasks: SchedTask[] = [
      { id: 'A', durationDays: 3, weight: 3, status: 'done', dependencies: [] },
      { id: 'B', durationDays: 1, weight: 1, status: 'in_progress', dependencies: [] },
    ];
    const p = computeProgress(tasks, now);
    expect(p.earnedPct).toBe(75); // 3 of 4 weight done
  });

  it('flags behind schedule when planned time has passed but work is not done', () => {
    const tasks: SchedTask[] = [
      {
        id: 'A',
        durationDays: 10,
        weight: 10,
        status: 'in_progress',
        dependencies: [],
        plannedStart: '2026-06-01',
        plannedEnd: '2026-06-11', // fully elapsed by `now`
      },
    ];
    const p = computeProgress(tasks, now);
    expect(p.earnedPct).toBe(0);
    expect(p.plannedPct).toBe(100);
    expect(p.spi).toBeLessThan(0.5);
    expect(scheduleHealth(p.spi)).toBe('behind');
  });

  it('is on track when earned matches planned', () => {
    expect(scheduleHealth(computeProgress([], now).spi)).toBe('on_track');
  });
});

describe('inclusiveDays', () => {
  it('counts inclusive whole days', () => {
    expect(inclusiveDays('2026-06-01', '2026-06-05')).toBe(5);
    expect(inclusiveDays(null, '2026-06-05')).toBe(1);
    expect(inclusiveDays('2026-06-01', '2026-06-01')).toBe(1);
  });
});
