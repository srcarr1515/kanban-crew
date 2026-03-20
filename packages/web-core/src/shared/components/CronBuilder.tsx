import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@vibe/ui/components/Input';
import { Textarea } from '@vibe/ui/components/Textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vibe/ui/components/Select';
import { cn } from '@/shared/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type ScheduleMode = 'simple' | 'cron';
type IntervalUnit = 'minutes' | 'hours' | 'daily' | 'weekly' | 'monthly';

export interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
  className?: string;
}

// ── Cron validation ──────────────────────────────────────────────────────────

const CRON_FIELD_RANGES: [number, number][] = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day of month
  [1, 12],  // month
  [0, 7],   // day of week (0 and 7 = Sunday)
];

function validateCronField(field: string, min: number, max: number): boolean {
  if (field === '*') return true;

  // Step values: */N or N/N
  const stepMatch = field.match(/^(\*|\d+)\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[2], 10);
    if (step < 1 || step > max) return false;
    if (stepMatch[1] !== '*') {
      const base = parseInt(stepMatch[1], 10);
      if (isNaN(base) || base < min || base > max) return false;
    }
    return true;
  }

  // Comma-separated values and ranges
  const parts = field.split(',');
  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1], 10);
      const hi = parseInt(rangeMatch[2], 10);
      if (isNaN(lo) || isNaN(hi) || lo < min || hi > max || lo > hi)
        return false;
    } else {
      const n = parseInt(part, 10);
      if (isNaN(n) || n < min || n > max) return false;
    }
  }
  return true;
}

export function validateCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return 'Cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week)';
  }
  const fieldNames = ['Minute', 'Hour', 'Day-of-month', 'Month', 'Day-of-week'];
  for (let i = 0; i < 5; i++) {
    const [min, max] = CRON_FIELD_RANGES[i];
    if (!validateCronField(parts[i], min, max)) {
      return `Invalid ${fieldNames[i]} field: "${parts[i]}"`;
    }
  }
  return null;
}

// ── Cron → human-readable description ────────────────────────────────────────

function formatHour(h: string): string {
  const n = parseInt(h, 10);
  if (isNaN(n)) return h;
  if (n === 0) return '12 AM';
  if (n < 12) return `${n} AM`;
  if (n === 12) return '12 PM';
  return `${n - 12} PM`;
}

function dayOfWeekName(dow: string): string {
  const map: Record<string, string> = {
    '0': 'Sunday',
    '1': 'Monday',
    '2': 'Tuesday',
    '3': 'Wednesday',
    '4': 'Thursday',
    '5': 'Friday',
    '6': 'Saturday',
    '7': 'Sunday',
  };
  return map[dow] ?? dow;
}

export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;

  const [min, hour, dom, mon, dow] = parts;

  // Every N minutes
  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${minStep[1]} minute(s)`;
  }

  // Every N hours
  const hourStep = hour.match(/^\*\/(\d+)$/);
  if (hourStep && min === '0' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${hourStep[1]} hour(s)`;
  }

  if (dom === '*' && mon === '*' && dow === '*') {
    if (min === '0' && hour === '0') return 'Daily at midnight';
    if (min === '0' && hour !== '*') return `Daily at ${formatHour(hour)}`;
    if (hour === '*' && min === '0') return 'Every hour';
    if (hour === '*') return `Every hour at :${min.padStart(2, '0')}`;
    return `Daily at ${formatHour(hour)}:${min.padStart(2, '0')}`;
  }

  if (dom === '*' && mon === '*' && dow !== '*') {
    const dayName = dayOfWeekName(dow);
    if (min === '0' && hour === '0') return `Every ${dayName} at midnight`;
    return `Every ${dayName} at ${formatHour(hour)}:${min.padStart(2, '0')}`;
  }

  if (dom !== '*' && mon === '*' && dow === '*') {
    return `Monthly on day ${dom} at ${formatHour(hour)}:${min.padStart(2, '0')}`;
  }

  return expr;
}

// ── Simple interval → cron conversion ────────────────────────────────────────

function intervalToCron(
  unit: IntervalUnit,
  every: number,
  hour: number,
  minute: number,
  dayOfWeek: number,
  dayOfMonth: number,
): string {
  switch (unit) {
    case 'minutes':
      return `*/${every} * * * *`;
    case 'hours':
      return `0 */${every} * * *`;
    case 'daily':
      return `${minute} ${hour} * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${dayOfWeek}`;
    case 'monthly':
      return `${minute} ${hour} ${dayOfMonth} * *`;
  }
}

// ── Try to parse a cron expression into simple interval fields ───────────────

interface SimpleFields {
  unit: IntervalUnit;
  every: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
}

function tryParseCronToSimple(expr: string): SimpleFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, mon, dow] = parts;

  if (mon !== '*') return null;

  // */N * * * * → every N minutes
  const minStep = min.match(/^\*\/(\d+)$/);
  if (minStep && hr === '*' && dom === '*' && dow === '*') {
    return { unit: 'minutes', every: parseInt(minStep[1], 10), hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 1 };
  }

  // 0 */N * * * → every N hours
  const hrStep = hr.match(/^\*\/(\d+)$/);
  if (min === '0' && hrStep && dom === '*' && dow === '*') {
    return { unit: 'hours', every: parseInt(hrStep[1], 10), hour: 9, minute: 0, dayOfWeek: 1, dayOfMonth: 1 };
  }

  // M H * * * → daily
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && dow === '*') {
    return { unit: 'daily', every: 1, hour: parseInt(hr, 10), minute: parseInt(min, 10), dayOfWeek: 1, dayOfMonth: 1 };
  }

  // M H * * D → weekly
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*' && /^\d+$/.test(dow)) {
    return { unit: 'weekly', every: 1, hour: parseInt(hr, 10), minute: parseInt(min, 10), dayOfWeek: parseInt(dow, 10), dayOfMonth: 1 };
  }

  // M H D * * → monthly
  if (/^\d+$/.test(min) && /^\d+$/.test(hr) && /^\d+$/.test(dom) && dow === '*') {
    return { unit: 'monthly', every: 1, hour: parseInt(hr, 10), minute: parseInt(min, 10), dayOfWeek: 1, dayOfMonth: parseInt(dom, 10) };
  }

  return null;
}

// ── CronBuilder component ────────────────────────────────────────────────────

export function CronBuilder({ value, onChange, className }: CronBuilderProps) {
  const [mode, setMode] = useState<ScheduleMode>(() => {
    return tryParseCronToSimple(value) ? 'simple' : 'cron';
  });

  // Simple mode fields
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('daily');
  const [intervalEvery, setIntervalEvery] = useState(1);
  const [intervalHour, setIntervalHour] = useState(9);
  const [intervalMinute, setIntervalMinute] = useState(0);
  const [intervalDayOfWeek, setIntervalDayOfWeek] = useState(1);
  const [intervalDayOfMonth, setIntervalDayOfMonth] = useState(1);

  // Cron mode raw input
  const [rawCron, setRawCron] = useState(value);

  // Validation error for cron mode
  const cronError = useMemo(() => {
    if (mode !== 'cron') return null;
    return validateCron(rawCron);
  }, [mode, rawCron]);

  // Initialize simple fields from the value prop on mount
  useEffect(() => {
    const parsed = tryParseCronToSimple(value);
    if (parsed) {
      setIntervalUnit(parsed.unit);
      setIntervalEvery(parsed.every);
      setIntervalHour(parsed.hour);
      setIntervalMinute(parsed.minute);
      setIntervalDayOfWeek(parsed.dayOfWeek);
      setIntervalDayOfMonth(parsed.dayOfMonth);
    }
    setRawCron(value);
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute cron from simple fields and propagate
  const computeAndEmitSimple = useCallback(
    (
      unit: IntervalUnit,
      every: number,
      hour: number,
      minute: number,
      dow: number,
      dom: number,
    ) => {
      const cron = intervalToCron(unit, every, hour, minute, dow, dom);
      onChange(cron);
    },
    [onChange],
  );

  const handleModeChange = useCallback(
    (newMode: ScheduleMode) => {
      setMode(newMode);
      if (newMode === 'simple') {
        // Try to parse current value into simple fields
        const parsed = tryParseCronToSimple(value);
        if (parsed) {
          setIntervalUnit(parsed.unit);
          setIntervalEvery(parsed.every);
          setIntervalHour(parsed.hour);
          setIntervalMinute(parsed.minute);
          setIntervalDayOfWeek(parsed.dayOfWeek);
          setIntervalDayOfMonth(parsed.dayOfMonth);
        }
        // Emit the simple-computed cron
        const fields = parsed ?? {
          unit: intervalUnit,
          every: intervalEvery,
          hour: intervalHour,
          minute: intervalMinute,
          dayOfWeek: intervalDayOfWeek,
          dayOfMonth: intervalDayOfMonth,
        };
        const cron = intervalToCron(
          fields.unit,
          fields.every,
          fields.hour,
          fields.minute,
          fields.dayOfWeek,
          fields.dayOfMonth,
        );
        onChange(cron);
      } else {
        setRawCron(value);
      }
    },
    [
      value,
      onChange,
      intervalUnit,
      intervalEvery,
      intervalHour,
      intervalMinute,
      intervalDayOfWeek,
      intervalDayOfMonth,
    ],
  );

  // Simple field change handlers
  const handleUnitChange = useCallback(
    (unit: IntervalUnit) => {
      setIntervalUnit(unit);
      computeAndEmitSimple(unit, intervalEvery, intervalHour, intervalMinute, intervalDayOfWeek, intervalDayOfMonth);
    },
    [computeAndEmitSimple, intervalEvery, intervalHour, intervalMinute, intervalDayOfWeek, intervalDayOfMonth],
  );
  const handleEveryChange = useCallback(
    (every: number) => {
      setIntervalEvery(every);
      computeAndEmitSimple(intervalUnit, every, intervalHour, intervalMinute, intervalDayOfWeek, intervalDayOfMonth);
    },
    [computeAndEmitSimple, intervalUnit, intervalHour, intervalMinute, intervalDayOfWeek, intervalDayOfMonth],
  );
  const handleHourChange = useCallback(
    (hour: number) => {
      setIntervalHour(hour);
      computeAndEmitSimple(intervalUnit, intervalEvery, hour, intervalMinute, intervalDayOfWeek, intervalDayOfMonth);
    },
    [computeAndEmitSimple, intervalUnit, intervalEvery, intervalMinute, intervalDayOfWeek, intervalDayOfMonth],
  );
  const handleMinuteChange = useCallback(
    (minute: number) => {
      setIntervalMinute(minute);
      computeAndEmitSimple(intervalUnit, intervalEvery, intervalHour, minute, intervalDayOfWeek, intervalDayOfMonth);
    },
    [computeAndEmitSimple, intervalUnit, intervalEvery, intervalHour, intervalDayOfWeek, intervalDayOfMonth],
  );
  const handleDayOfWeekChange = useCallback(
    (dow: number) => {
      setIntervalDayOfWeek(dow);
      computeAndEmitSimple(intervalUnit, intervalEvery, intervalHour, intervalMinute, dow, intervalDayOfMonth);
    },
    [computeAndEmitSimple, intervalUnit, intervalEvery, intervalHour, intervalMinute, intervalDayOfMonth],
  );
  const handleDayOfMonthChange = useCallback(
    (dom: number) => {
      setIntervalDayOfMonth(dom);
      computeAndEmitSimple(intervalUnit, intervalEvery, intervalHour, intervalMinute, intervalDayOfWeek, dom);
    },
    [computeAndEmitSimple, intervalUnit, intervalEvery, intervalHour, intervalMinute, intervalDayOfWeek],
  );

  // Raw cron input handler
  const handleRawCronChange = useCallback(
    (raw: string) => {
      setRawCron(raw);
      const err = validateCron(raw);
      if (!err) {
        onChange(raw.trim());
      }
    },
    [onChange],
  );

  const preview = describeCron(value);

  return (
    <div className={cn('space-y-2', className)}>
      {/* Mode toggle */}
      <div className="flex gap-1 p-0.5 bg-secondary rounded w-fit">
        <button
          type="button"
          className={cn(
            'px-3 py-1 text-xs rounded transition-colors',
            mode === 'simple'
              ? 'bg-primary text-high shadow-sm'
              : 'text-low hover:text-normal',
          )}
          onClick={() => handleModeChange('simple')}
        >
          Simple
        </button>
        <button
          type="button"
          className={cn(
            'px-3 py-1 text-xs rounded transition-colors',
            mode === 'cron'
              ? 'bg-primary text-high shadow-sm'
              : 'text-low hover:text-normal',
          )}
          onClick={() => handleModeChange('cron')}
        >
          Cron
        </button>
      </div>

      {/* Builder content */}
      {mode === 'simple' ? (
        <SimpleIntervalBuilder
          unit={intervalUnit}
          every={intervalEvery}
          hour={intervalHour}
          minute={intervalMinute}
          dayOfWeek={intervalDayOfWeek}
          dayOfMonth={intervalDayOfMonth}
          onUnitChange={handleUnitChange}
          onEveryChange={handleEveryChange}
          onHourChange={handleHourChange}
          onMinuteChange={handleMinuteChange}
          onDayOfWeekChange={handleDayOfWeekChange}
          onDayOfMonthChange={handleDayOfMonthChange}
        />
      ) : (
        <div className="space-y-1">
          <Textarea
            className="font-ibm-plex-mono text-sm min-h-[40px] h-10"
            placeholder="0 9 * * *"
            value={rawCron}
            onChange={(e) => handleRawCronChange(e.target.value)}
          />
          <p className="text-xs text-low">
            Format: minute hour day-of-month month day-of-week
          </p>
          {cronError && (
            <p className="text-xs text-error">{cronError}</p>
          )}
        </div>
      )}

      {/* Live preview */}
      <p className="text-xs text-low">
        Preview: {preview}
      </p>
    </div>
  );
}

// ── Simple Interval Builder (internal) ───────────────────────────────────────

interface SimpleIntervalBuilderProps {
  unit: IntervalUnit;
  every: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
  onUnitChange: (u: IntervalUnit) => void;
  onEveryChange: (n: number) => void;
  onHourChange: (n: number) => void;
  onMinuteChange: (n: number) => void;
  onDayOfWeekChange: (n: number) => void;
  onDayOfMonthChange: (n: number) => void;
}

function SimpleIntervalBuilder({
  unit,
  every,
  hour,
  minute,
  dayOfWeek,
  dayOfMonth,
  onUnitChange,
  onEveryChange,
  onHourChange,
  onMinuteChange,
  onDayOfWeekChange,
  onDayOfMonthChange,
}: SimpleIntervalBuilderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-normal">Every</span>

      {(unit === 'minutes' || unit === 'hours') && (
        <Input
          type="number"
          className="w-16 h-8 text-sm text-center"
          min={1}
          max={unit === 'minutes' ? 59 : 23}
          value={every}
          onChange={(e) =>
            onEveryChange(Math.max(1, parseInt(e.target.value, 10) || 1))
          }
        />
      )}

      <Select value={unit} onValueChange={(v) => onUnitChange(v as IntervalUnit)}>
        <SelectTrigger className="w-28 h-8 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="minutes">minute(s)</SelectItem>
          <SelectItem value="hours">hour(s)</SelectItem>
          <SelectItem value="daily">day</SelectItem>
          <SelectItem value="weekly">week</SelectItem>
          <SelectItem value="monthly">month</SelectItem>
        </SelectContent>
      </Select>

      {unit === 'weekly' && (
        <>
          <span className="text-sm text-normal">on</span>
          <Select
            value={String(dayOfWeek)}
            onValueChange={(v) => onDayOfWeekChange(parseInt(v, 10))}
          >
            <SelectTrigger className="w-32 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Monday</SelectItem>
              <SelectItem value="2">Tuesday</SelectItem>
              <SelectItem value="3">Wednesday</SelectItem>
              <SelectItem value="4">Thursday</SelectItem>
              <SelectItem value="5">Friday</SelectItem>
              <SelectItem value="6">Saturday</SelectItem>
              <SelectItem value="0">Sunday</SelectItem>
            </SelectContent>
          </Select>
        </>
      )}

      {unit === 'monthly' && (
        <>
          <span className="text-sm text-normal">on day</span>
          <Select
            value={String(dayOfMonth)}
            onValueChange={(v) => onDayOfMonthChange(parseInt(v, 10))}
          >
            <SelectTrigger className="w-20 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 31 }, (_, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}

      {(unit === 'daily' || unit === 'weekly' || unit === 'monthly') && (
        <>
          <span className="text-sm text-normal">at</span>
          <Select
            value={String(hour)}
            onValueChange={(v) => onHourChange(parseInt(v, 10))}
          >
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, i) => (
                <SelectItem key={i} value={String(i)}>
                  {formatHour(String(i))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-normal">:</span>
          <Select
            value={String(minute)}
            onValueChange={(v) => onMinuteChange(parseInt(v, 10))}
          >
            <SelectTrigger className="w-20 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(
                (m) => (
                  <SelectItem key={m} value={String(m)}>
                    {String(m).padStart(2, '0')}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </>
      )}
    </div>
  );
}
