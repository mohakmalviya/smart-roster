import type { ISODate, Weekday } from './types';

// All date math is done on UTC calendar dates to avoid timezone drift.

export function parseISO(d: ISODate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  const x = parseISO(d);
  x.setUTCDate(x.getUTCDate() + n);
  return toISO(x);
}

const weekdayCache = new Map<ISODate, Weekday>();
/** Cached: the generator asks for the same dates thousands of times. */
export function weekday(d: ISODate): Weekday {
  let w = weekdayCache.get(d);
  if (w === undefined) {
    w = parseISO(d).getUTCDay() as Weekday;
    weekdayCache.set(d, w);
  }
  return w;
}

/** All dates of a month "yyyy-mm". */
export function monthDates(month: string): ISODate[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: ISODate[] = [];
  for (let i = 1; i <= days; i++) out.push(`${month}-${String(i).padStart(2, '0')}`);
  return out;
}

/**
 * Splits the month's dates into Mon–Sun calendar weeks (clipped to the month).
 */
export function monthWeeks(month: string): ISODate[][] {
  const weeks: ISODate[][] = [];
  let cur: ISODate[] = [];
  for (const d of monthDates(month)) {
    if (weekday(d) === 1 && cur.length) {
      weeks.push(cur);
      cur = [];
    }
    cur.push(d);
  }
  if (cur.length) weeks.push(cur);
  return weeks;
}

/**
 * Full Mon–Sun weeks that touch the month (first/last week may spill into the
 * neighbouring months). Weekly offs are owed per full week, so a week that
 * straddles two months is planned as one unit.
 */
export function fullWeeks(month: string): ISODate[][] {
  const dates = monthDates(month);
  const first = dates[0];
  const back = (weekday(first) + 6) % 7; // days since Monday
  let cur = addDays(first, -back);
  const last = dates[dates.length - 1];
  const out: ISODate[][] = [];
  while (cur <= last) {
    const w: ISODate[] = [];
    for (let i = 0; i < 7; i++) w.push(addDays(cur, i));
    out.push(w);
    cur = addDays(cur, 7);
  }
  return out;
}

export function inRange(d: ISODate, start: ISODate, end: ISODate): boolean {
  return d >= start && d <= end;
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function fmtDate(d: ISODate): string {
  const x = parseISO(d);
  return `${WEEKDAY_SHORT[x.getUTCDay()]} ${x.getUTCDate()} ${x.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`;
}

export function monthLabel(month: string): string {
  const x = parseISO(`${month}-01`);
  return x.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1 + delta, 1));
  return x.toISOString().slice(0, 7);
}

const minutesCache = new Map<string, number>();
export function minutes(hhmm: string): number {
  let v = minutesCache.get(hhmm);
  if (v === undefined) {
    const [h, m] = hhmm.split(':').map(Number);
    v = h * 60 + m;
    minutesCache.set(hhmm, v);
  }
  return v;
}

/** "shift" or "shifts" for a count. */
export function plural(n: number, one: string, many = one + 's'): string {
  return n === 1 ? one : many;
}
