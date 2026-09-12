import type { Period } from "@/types/collage";

export function isCalendarDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

// Calendar arithmetic; no conversion of watchedDate to an instant or timezone.
function previousDate(value: string): string {
  let [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  if (--day === 0) {
    if (--month === 0) { month = 12; year--; }
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    day = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
  }
  return formatParts(year, month, day);
}

function formatParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getDateRange(period: Exclude<Period, "custom">, now = new Date()): { start: string; end: string } {
  const end = formatParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
  let start = end;
  const days = period === "week" ? 7 : 30;
  for (let i = 1; i < days; i++) start = previousDate(start);
  return { start, end };
}

export function isValidRange(start: string, end: string): boolean {
  return isCalendarDate(start) && isCalendarDate(end) && start <= end;
}

export function displayDate(value: string): string {
  return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
}

export function displayRange(start: string, end: string): string {
  return `${displayDate(start)} a ${displayDate(end)}`;
}
