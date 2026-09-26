/**
 * Experience duration from structured dates (pure). Never estimated from prose.
 * Overlapping or concurrent roles are merged so time is never double-counted.
 */

/** "2023" | "2023-04" → month index (year*12 + month-1). A bare year counts from January. */
export function parseMonth(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 1;
  if (month < 1 || month > 12 || year < 1950 || year > 2100) return null;
  return year * 12 + (month - 1);
}

export function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export interface Period {
  start: number;
  /** exclusive */
  end: number;
}

/**
 * A role's period, or null when its dates cannot be determined.
 * End is exclusive; a role that starts and ends in the same month counts as one month.
 * An open-ended role only counts up to now when it is marked current.
 */
export function rolePeriod(
  role: { startDate: string | null; endDate: string | null; isCurrent: boolean },
  now: Date,
): Period | null {
  const start = parseMonth(role.startDate);
  if (start === null) return null;
  const endMonth = role.isCurrent ? monthIndex(now) : parseMonth(role.endDate);
  if (endMonth === null || endMonth < start) return null;
  return { start, end: Math.min(endMonth, monthIndex(now)) + 1 };
}

/** Total months covered by the union of periods (overlaps counted once). */
export function mergedMonths(periods: Period[]): number {
  const sorted = [...periods].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const p of sorted) {
    if (p.start > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = p.start;
      curEnd = p.end;
    } else {
      curEnd = Math.max(curEnd, p.end);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

/** Employment types that count as professional work experience. */
export const PROFESSIONAL_TYPES = new Set([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "FREELANCE",
  "INTERNSHIP",
  "SELF_EMPLOYED",
  "TEMPORARY",
]);

export const formatYears = (months: number) => {
  const years = months / 12;
  return years >= 1 ? `${years.toFixed(1).replace(/\.0$/, "")} years` : `${months} months`;
};
