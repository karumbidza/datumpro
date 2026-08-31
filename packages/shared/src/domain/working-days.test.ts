import { describe, it, expect } from 'vitest';
import { addWorkingDays, workingDaysBetween, type WorkCalendar } from './working-days';

// Mon–Fri working; Sat/Sun off; one holiday Fri 2026-09-04.
const cal: WorkCalendar = { workingDows: [1, 2, 3, 4, 5], holidays: ['2026-09-04'] };

describe('addWorkingDays', () => {
  it('0 days returns the same date when it is a working day', () => {
    expect(addWorkingDays('2026-09-01', 0, cal)).toBe('2026-09-01'); // Tue
  });
  it('0 days rolls a weekend start forward to the next working day', () => {
    expect(addWorkingDays('2026-09-05', 0, cal)).toBe('2026-09-07'); // Sat → Mon
  });
  it('adds working days skipping the weekend', () => {
    // Thu 09-03 + 1 wd → skips holiday Fri 09-04 and the weekend → Mon 09-07
    expect(addWorkingDays('2026-09-03', 1, cal)).toBe('2026-09-07');
  });
  it('adds within a week', () => {
    expect(addWorkingDays('2026-09-01', 2, cal)).toBe('2026-09-03'); // Tue +2wd → Thu
  });
});

describe('workingDaysBetween', () => {
  it('counts inclusive working days', () => {
    // Tue 09-01 .. Mon 09-07 inclusive, skipping 09-04 holiday + weekend = Tue,Wed,Thu,Mon = 4
    expect(workingDaysBetween('2026-09-01', '2026-09-07', cal)).toBe(4);
  });
});
