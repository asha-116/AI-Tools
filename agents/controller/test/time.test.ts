import { describe, expect, it } from 'vitest';
import {
  addDays,
  isValidDate,
  istDate,
  istDateOfIso,
  istDayWindow,
  isoWeekOf,
  isoWeekRange,
  weekday,
} from '../src/time.js';

// Known answers: ISO 8601 week numbering as computed by Python's
// datetime.date.isocalendar() (an independent implementation of the standard), e.g.
// date(2026,12,31).isocalendar() == (2026, 53, 4); date(2027,1,4).isocalendar() == (2027, 1, 1).
// IST = UTC+05:30 with no daylight saving (Indian Standard Time, IS 1957 / NPL).

describe('istDate (Razorpay unix seconds → IST business day)', () => {
  it('23:59:59 IST on 31 Dec is still 31 Dec', () => {
    // 2026-12-31T18:29:59Z
    expect(istDate(1798741799)).toBe('2026-12-31');
  });
  it('00:00 IST on 1 Jan is the next day although UTC is still 31 Dec', () => {
    // 2026-12-31T18:30:00Z
    expect(istDate(1798741800)).toBe('2027-01-01');
  });
  it('converts ISO instants from D1', () => {
    expect(istDateOfIso('2026-12-31T18:30:00.000Z')).toBe('2027-01-01');
    expect(istDateOfIso('2026-12-31T18:29:59.999Z')).toBe('2026-12-31');
    expect(istDateOfIso('not a date')).toBeNull();
  });
});

describe('istDayWindow', () => {
  it('is [00:00 IST, next 00:00 IST)', () => {
    expect(istDayWindow('2027-01-01')).toEqual({ fromUnix: 1798741800, toUnix: 1798828200 });
    expect(istDayWindow('2026-10-05')).toEqual({ fromUnix: 1791138600, toUnix: 1791225000 });
  });
  it('rejects malformed and impossible dates', () => {
    expect(() => istDayWindow('2026-02-30')).toThrow(/bad date/);
    expect(() => istDayWindow('5 Oct 2026')).toThrow(/bad date/);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2027-02-29')).toBe(false);
  });
});

describe('ISO weeks', () => {
  it.each([
    ['2026-12-31', '2026-W53'],
    ['2027-01-01', '2026-W53'],
    ['2027-01-03', '2026-W53'],
    ['2027-01-04', '2027-W01'],
    ['2024-12-30', '2025-W01'],
    ['2021-01-03', '2020-W53'],
    ['2026-10-04', '2026-W40'],
    ['2026-10-05', '2026-W41'],
    ['2026-10-11', '2026-W41'],
  ])('%s is in %s', (date, week) => {
    expect(isoWeekOf(date)).toBe(week);
  });

  it('weekday is Monday = 0', () => {
    expect(weekday('2026-10-05')).toBe(0);
    expect(weekday('2026-10-11')).toBe(6);
  });

  it('week range spans the year boundary, with IST unix bounds', () => {
    expect(isoWeekRange('2026-W53')).toEqual({
      week: '2026-W53',
      startDate: '2026-12-28',
      endDate: '2027-01-03',
      fromUnix: 1798396200, // 2026-12-27T18:30:00Z = Mon 28 Dec 00:00 IST
      toUnix: 1799001000, // 2027-01-03T18:30:00Z = Mon 4 Jan 00:00 IST
    });
    expect(isoWeekRange('2025-W01').startDate).toBe('2024-12-30');
  });

  it('rejects weeks that do not exist', () => {
    expect(() => isoWeekRange('2027-W53')).toThrow(/bad ISO week/);
    expect(() => isoWeekRange('2027-W00')).toThrow(/bad ISO week/);
    expect(() => isoWeekRange('2027-53')).toThrow(/bad ISO week/);
  });

  it('addDays crosses month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
