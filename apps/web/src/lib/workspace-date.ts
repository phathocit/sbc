export type WorkspaceDateOptions = {
  year?: boolean;
  weekday?: 'long' | 'short';
  includeTime?: boolean;
  timeZone?: string;
};

/** Format workspace dates consistently as dd/mm/yyyy or dd/mm, with optional weekday/time. */
export function formatWorkspaceDate(value: string | Date, options: WorkspaceDateOptions = {}): string {
  const { year = true, weekday, includeTime = false, timeZone } = options;
  const dateOnly = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const date = value instanceof Date ? value : new Date(dateOnly ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(date.getTime())) return '';

  let day: string;
  let month: string;
  let dateYear: string;
  if (dateOnly) {
    [, dateYear, month, day] = dateOnly;
  } else {
    const dateFormatter = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = Object.fromEntries(dateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
    day = parts.day;
    month = parts.month;
    dateYear = parts.year;
  }

  const dateText = year ? `${day}/${month}/${dateYear}` : `${day}/${month}`;
  const weekdayText = weekday
    ? new Intl.DateTimeFormat('vi-VN', { weekday, timeZone: dateOnly ? 'UTC' : timeZone }).format(date)
    : '';
  const timeText = includeTime
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) })
      .format(date)
    : '';

  return `${weekdayText ? `${weekdayText}, ` : ''}${dateText}${timeText ? `, ${timeText}` : ''}`;
}
