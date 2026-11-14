import { expect, it } from 'vitest';
import { isValidReminderOffset, normalizeReminderOffsets, reminderLabel, reminderListLabel } from '../src/reminders';

it.each([
  [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour'], [90, '1 hour 30 minutes'],
  [1440, '1 day'], [2880, '2 days'], [1505, '1 day 1 hour 5 minutes'], [10080, '7 days'],
])('formats %i minutes as %s', (minutes, label) => {
  expect(reminderLabel(minutes as number)).toBe(label);
});

it('lists reminders largest first', () => {
  expect(reminderListLabel([15])).toBe('15 minutes');
  expect(reminderListLabel([15, 1440])).toBe('1 day and 15 minutes');
  expect(reminderListLabel([15, 60, 1440])).toBe('1 day, 1 hour and 15 minutes');
  expect(reminderListLabel([])).toBe('');
});

it('validates and normalizes offsets', () => {
  expect([4, 5, 10080, 10081, 5.5].map(isValidReminderOffset)).toEqual([false, true, true, false, false]);
  expect(normalizeReminderOffsets([1440, 15, 15])).toEqual([15, 1440]);
});
