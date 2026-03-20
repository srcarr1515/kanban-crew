import { describe, it, expect } from 'vitest';
import { validateCron, describeCron } from './CronBuilder';

// ── validateCron ────────────────────────────────────────────────────────────

describe('validateCron', () => {
  it('accepts a standard 5-field cron', () => {
    expect(validateCron('0 9 * * *')).toBeNull();
  });

  it('accepts wildcards in all fields', () => {
    expect(validateCron('* * * * *')).toBeNull();
  });

  it('accepts step values', () => {
    expect(validateCron('*/5 * * * *')).toBeNull();
    expect(validateCron('0 */2 * * *')).toBeNull();
  });

  it('accepts ranges', () => {
    expect(validateCron('0-30 * * * *')).toBeNull();
    expect(validateCron('0 9-17 * * *')).toBeNull();
  });

  it('accepts comma-separated values', () => {
    expect(validateCron('0,15,30,45 * * * *')).toBeNull();
    expect(validateCron('0 9 * * 1,3,5')).toBeNull();
  });

  it('accepts day-of-week 0 and 7 as Sunday', () => {
    expect(validateCron('0 9 * * 0')).toBeNull();
    expect(validateCron('0 9 * * 7')).toBeNull();
  });

  it('rejects too few fields', () => {
    expect(validateCron('0 9')).not.toBeNull();
    expect(validateCron('* *')).not.toBeNull();
  });

  it('rejects too many fields', () => {
    expect(validateCron('0 0 9 * * * *')).not.toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateCron('')).not.toBeNull();
  });

  it('rejects out-of-range minute', () => {
    expect(validateCron('60 * * * *')).not.toBeNull();
  });

  it('rejects out-of-range hour', () => {
    expect(validateCron('0 24 * * *')).not.toBeNull();
  });

  it('rejects out-of-range day-of-month', () => {
    expect(validateCron('0 0 32 * *')).not.toBeNull();
    expect(validateCron('0 0 0 * *')).not.toBeNull();
  });

  it('rejects out-of-range month', () => {
    expect(validateCron('0 0 * 13 *')).not.toBeNull();
    expect(validateCron('0 0 * 0 *')).not.toBeNull();
  });

  it('rejects out-of-range day-of-week', () => {
    expect(validateCron('0 0 * * 8')).not.toBeNull();
  });

  it('rejects inverted range', () => {
    expect(validateCron('30-10 * * * *')).not.toBeNull();
  });

  it('rejects non-numeric values', () => {
    expect(validateCron('abc * * * *')).not.toBeNull();
  });

  it('rejects step value of 0', () => {
    expect(validateCron('*/0 * * * *')).not.toBeNull();
  });
});

// ── describeCron ────────────────────────────────────────────────────────────

describe('describeCron', () => {
  it('describes every N minutes', () => {
    expect(describeCron('*/5 * * * *')).toBe('Every 5 minute(s)');
    expect(describeCron('*/15 * * * *')).toBe('Every 15 minute(s)');
  });

  it('describes every N hours', () => {
    expect(describeCron('0 */2 * * *')).toBe('Every 2 hour(s)');
  });

  it('describes daily at midnight', () => {
    expect(describeCron('0 0 * * *')).toBe('Daily at midnight');
  });

  it('describes daily at specific hour', () => {
    expect(describeCron('0 9 * * *')).toBe('Daily at 9 AM');
    expect(describeCron('0 14 * * *')).toBe('Daily at 2 PM');
    expect(describeCron('0 0 * * *')).toBe('Daily at midnight');
  });

  it('describes daily at hour:minute', () => {
    expect(describeCron('30 9 * * *')).toBe('Daily at 9 AM:30');
  });

  it('describes every hour', () => {
    expect(describeCron('0 * * * *')).toBe('Every hour');
  });

  it('describes every hour at specific minute', () => {
    expect(describeCron('15 * * * *')).toBe('Every hour at :15');
  });

  it('describes weekly schedules', () => {
    expect(describeCron('0 0 * * 1')).toBe('Every Monday at midnight');
    expect(describeCron('30 9 * * 5')).toBe('Every Friday at 9 AM:30');
  });

  it('describes monthly schedules', () => {
    expect(describeCron('0 9 15 * *')).toBe('Monthly on day 15 at 9 AM:00');
  });

  it('falls back to raw expression for complex crons', () => {
    const complex = '0 9 1 6 3';
    expect(describeCron(complex)).toBe(complex);
  });

  it('handles expression with fewer than 5 parts gracefully', () => {
    expect(describeCron('0 9')).toBe('0 9');
  });

  it('formats 12 PM correctly', () => {
    expect(describeCron('0 12 * * *')).toBe('Daily at 12 PM');
  });

  it('formats 12 AM correctly', () => {
    expect(describeCron('0 0 * * *')).toBe('Daily at midnight');
  });

  it('maps day-of-week names correctly', () => {
    expect(describeCron('0 9 * * 0')).toContain('Sunday');
    expect(describeCron('0 9 * * 6')).toContain('Saturday');
    expect(describeCron('0 9 * * 7')).toContain('Sunday');
  });
});
