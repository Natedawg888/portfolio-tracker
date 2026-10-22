/**
 * Wall-clock time in a time zone (Pacific/Auckland by default) to and from UTC, for meetings
 * that are entered and shown in NZ time but stored as UTC instants.
 *
 * Daylight saving rules:
 * - A time that doesn't exist (the hour skipped when clocks go forward, 2:00–2:59am on the last
 *   Sunday of September in NZ) is refused, so a meeting is never moved without the user knowing.
 * - A time that happens twice (2:00–2:59am on the first Sunday of April, when clocks go back)
 *   is the first of the two, while daylight time is still on.
 */
export const NZ_TZ = 'Pacific/Auckland';

export type LocalParts = { date: string; time: string };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date ('YYYY-MM-DD') and time ('HH:MM') of a UTC instant in a time zone. */
export function utcToLocal(utcMs: number, timeZone = NZ_TZ): LocalParts {
  const p = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function wallMs(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min);
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const l = utcToLocal(utcMs, timeZone);
  return Math.round((wallMs(l.date, l.time) - utcMs) / 60_000);
}

const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type LocalToUtc =
  | { ok: true; utcMs: number }
  | { ok: false; reason: 'invalid' | 'nonexistent' };

/** The UTC instant of a wall-clock date and time in a time zone (see the rules above). */
export function localToUtc(date: string, time: string, timeZone = NZ_TZ): LocalToUtc {
  if (!YMD.test(date) || !HM.test(time)) return { ok: false, reason: 'invalid' };
  const wall = wallMs(date, time);
  if (utcToLocal(wall, 'UTC').date !== date) return { ok: false, reason: 'invalid' };
  // The offset a day either side covers both sides of any DST change.
  const candidates = [...new Set([offsetMinutes(wall - 86_400_000, timeZone), offsetMinutes(wall + 86_400_000, timeZone)])]
    .map((off) => wall - off * 60_000)
    .filter((utc) => {
      const back = utcToLocal(utc, timeZone);
      return back.date === date && back.time === time;
    })
    .sort((a, b) => a - b);
  return candidates.length ? { ok: true, utcMs: candidates[0] } : { ok: false, reason: 'nonexistent' };
}

/** 'YYYY-MM-DD' plus days. */
export function addDays(date: string, days: number): string {
  return utcToLocal(wallMs(date, '00:00') + days * 86_400_000, 'UTC').date;
}

/** The UTC instants [start, end) covering local dates from..to inclusive. */
export function localDateRangeUtc(from: string, to: string, timeZone = NZ_TZ): { startMs: number; endMs: number } {
  return { startMs: startOfLocalDay(from, timeZone), endMs: startOfLocalDay(addDays(to, 1), timeZone) };
}

/** Midnight can't fall in NZ's skipped hour, but other zones skip midnight; take the first minute that exists. */
function startOfLocalDay(date: string, timeZone: string): number {
  for (let h = 0; h < 3; h++) {
    const r = localToUtc(date, `0${h}:00`, timeZone);
    if (r.ok) return r.utcMs;
  }
  return wallMs(date, '00:00');
}

/** '2:30pm' style, as the app writes times. */
export function formatTime12(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}
