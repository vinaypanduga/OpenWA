import { isValidTimeZone, nextWeeklyOccurrence } from './weekly-recurrence';

describe('weekly recurrence', () => {
  it('uses the selected weekdays and local wall-clock time', () => {
    // Monday 09:30 in India: today's 10:00 occurrence is still available.
    expect(
      nextWeeklyOccurrence([1, 2], '10:00', 'Asia/Kolkata', new Date('2026-09-07T04:00:00.000Z')).toISOString(),
    ).toBe('2026-09-07T04:30:00.000Z');

    // Once Monday's time has passed, Tuesday is selected next.
    expect(
      nextWeeklyOccurrence([1, 2], '10:00', 'Asia/Kolkata', new Date('2026-09-07T05:00:00.000Z')).toISOString(),
    ).toBe('2026-09-08T04:30:00.000Z');
  });

  it('rejects unknown IANA timezone names', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Not/A_Timezone')).toBe(false);
  });
});
