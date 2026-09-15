export function businessDaysInclusive(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  let days = 0;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return Math.max(days, 1);
}

export function centralDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { year: Number(value("year")), month: Number(value("month")), day: Number(value("day")) };
}

export function isoDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

export function dashboardRanges() {
  const central = centralDateParts();
  const today = new Date(Date.UTC(central.year, central.month - 1, central.day));
  const daysSinceWednesday = (today.getUTCDay() - 3 + 7) % 7;
  const thisStart = new Date(today);
  thisStart.setUTCDate(today.getUTCDate() - daysSinceWednesday);
  const thisEnd = new Date(thisStart);
  thisEnd.setUTCDate(thisStart.getUTCDate() + 6);
  const lastStart = new Date(thisStart);
  lastStart.setUTCDate(thisStart.getUTCDate() - 7);
  const lastEnd = new Date(thisStart);
  lastEnd.setUTCDate(thisStart.getUTCDate() - 1);
  const monthStart = isoDate(central.year, central.month, 1);
  const monthEnd = isoDate(central.year, central.month + 1, 0);
  return {
    today: isoDate(central.year, central.month, central.day),
    thisWeek: { start: thisStart.toISOString().slice(0, 10), end: thisEnd.toISOString().slice(0, 10) },
    lastWeek: { start: lastStart.toISOString().slice(0, 10), end: lastEnd.toISOString().slice(0, 10) },
    month: { start: monthStart, end: monthEnd },
  };
}

export function reportingWeekKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  const localDate = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  localDate.setUTCDate(localDate.getUTCDate() - ((localDate.getUTCDay() - 3 + 7) % 7));
  return localDate.toISOString().slice(0, 10);
}
