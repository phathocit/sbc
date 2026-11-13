export interface LocalTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsAt(instant: Date, timezone: string): LocalTimeParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

function wallStamp(parts: LocalTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function offsetMinutes(instant: Date, timezone: string): number {
  const rounded = Math.floor(instant.getTime() / 1000) * 1000;
  return (wallStamp(partsAt(instant, timezone)) - rounded) / 60_000;
}

export function localDateTimeToInstants(date: string, minuteOfDay: number, timezone: string): Date[] {
  const [year, month, day] = date.split('-').map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const target = { year, month, day, hour, minute, second: 0 };
  const naive = wallStamp(target);
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(offsetMinutes(new Date(naive + hours * 3_600_000), timezone));
  }
  const instants = [...offsets]
    .map((offset) => new Date(naive - offset * 60_000))
    .filter((instant) => wallStamp(partsAt(instant, timezone)) === naive)
    .sort((a, b) => a.getTime() - b.getTime());
  return instants.filter((instant, index) => index === 0 || instant.getTime() !== instants[index - 1].getTime());
}

export function resolveLocalBoundary(date: string, minuteOfDay: number, timezone: string, direction: 'start' | 'end'): Date | null {
  const exact = localDateTimeToInstants(date, minuteOfDay, timezone);
  if (exact.length) return direction === 'start' ? exact[0] : exact[exact.length - 1];
  for (let delta = 1; delta < 1440; delta += 1) {
    const minute = direction === 'start' ? minuteOfDay + delta : minuteOfDay - delta;
    if (minute < 0 || minute > 1439) break;
    const candidates = localDateTimeToInstants(date, minute, timezone);
    if (candidates.length) return direction === 'start' ? candidates[0] : candidates[candidates.length - 1];
  }
  return null;
}

export function localDayBounds(date: string, timezone: string): { start: Date; end: Date } | null {
  const start = resolveLocalBoundary(date, 0, timezone, 'start');
  const end = resolveLocalBoundary(nextLocalDate(date), 0, timezone, 'start');
  return start && end ? { start, end } : null;
}

export function formatLocalDate(instant: Date, timezone: string): string {
  const parts = partsAt(instant, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function formatLocalTime(instant: Date, timezone: string): { time: string; offset: string } {
  const parts = partsAt(instant, timezone);
  const time = `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  const offset = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'shortOffset' })
    .formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value ?? timezone;
  return { time, offset };
}

export function nextLocalDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export function parseLocalDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}
