import { describe, it, expect } from 'vitest';
import { shiftDate } from '../../server/api.js';

describe('shiftDate', () => {
  it('moves daily and weekly', () => {
    expect(shiftDate('2026-12-31', 'daily')).toBe('2027-01-01');
    expect(shiftDate('2026-03-02', 'weekly')).toBe('2026-03-09');
  });
  it('clamps monthly to the last day', () => {
    expect(shiftDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(shiftDate('2026-12-15', 'monthly')).toBe('2027-01-15');
  });
  it('keeps the time and passes empty values through', () => {
    expect(shiftDate('2026-05-01T09:30', 'daily')).toBe('2026-05-02T09:30');
    expect(shiftDate(null, 'daily')).toBe(null);
  });
});
