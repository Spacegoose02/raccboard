import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, daysBetween, dueStatus, fromYmd, parseDate, ymd } from '../../client/src/dates.js';

describe('dates', () => {
  afterEach(() => vi.useRealTimers());

  it('treats a date-only value as the end of that day', () => {
    const d = parseDate('2026-03-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 2, 4, 23]);
  });
  it('rejects junk', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
  it('round-trips local calendar days', () => {
    expect(ymd(fromYmd('2026-12-31'))).toBe('2026-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
  });
  it('classifies due dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 10, 12, 0));
    expect(dueStatus('2026-06-09', false)).toBe('overdue');
    expect(dueStatus('2026-06-10', false)).toBe('soon');
    expect(dueStatus('2026-06-20', false)).toBe('');
    expect(dueStatus('2026-06-09', true)).toBe('done');
    expect(dueStatus(null, false)).toBe('');
  });
});
