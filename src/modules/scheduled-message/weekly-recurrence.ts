interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
};

const zonedParts = (date: Date, timeZone: string): ZonedDateParts => {
  const values = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
};

const wallClockValue = (parts: ZonedDateParts): number =>
  Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);

const sameWallClock = (left: ZonedDateParts, right: ZonedDateParts): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute;

const wallClockToInstant = (parts: ZonedDateParts, timeZone: string): Date | null => {
  let timestamp = wallClockValue(parts);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedParts(new Date(timestamp), timeZone);
    const correction = wallClockValue(parts) - wallClockValue(actual);
    if (correction === 0) break;
    timestamp += correction;
  }
  const result = new Date(timestamp);
  // A local time inside a daylight-saving gap does not exist. Skip that occurrence rather than
  // silently delivering at a different wall-clock time.
  return sameWallClock(zonedParts(result, timeZone), parts) ? result : null;
};

export const isValidTimeZone = (timeZone: string): boolean => {
  try {
    formatterFor(timeZone).format(new Date());
    return true;
  } catch {
    formatterCache.delete(timeZone);
    return false;
  }
};

/** Returns the first selected weekday/time strictly after `after` (0=Sunday ... 6=Saturday). */
export const nextWeeklyOccurrence = (weekdays: number[], time: string, timeZone: string, after: Date): Date => {
  const selected = new Set(weekdays);
  const [hour, minute] = time.split(':').map(Number);
  const localAfter = zonedParts(after, timeZone);
  const localMidnight = Date.UTC(localAfter.year, localAfter.month - 1, localAfter.day);

  // Fourteen days also covers the rare case where the first selected occurrence is skipped by a
  // daylight-saving gap.
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const calendarDate = new Date(localMidnight + dayOffset * 86_400_000);
    if (!selected.has(calendarDate.getUTCDay())) continue;
    const candidate = wallClockToInstant(
      {
        year: calendarDate.getUTCFullYear(),
        month: calendarDate.getUTCMonth() + 1,
        day: calendarDate.getUTCDate(),
        hour,
        minute,
      },
      timeZone,
    );
    if (candidate && candidate.getTime() > after.getTime()) return candidate;
  }
  throw new Error('Unable to calculate the next weekly occurrence');
};
