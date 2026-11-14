/** Run reminder limits, in minutes before the run. */
export const REMINDER_MIN_MINUTES = 5;
export const REMINDER_MAX_MINUTES = 7 * 1440;
export const MAX_REMINDERS = 3;

/** A Discord snowflake (user, role or channel ID). */
export const DISCORD_SNOWFLAKE = /^[1-9]\d{16,19}$/;

export function isValidReminderOffset(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= REMINDER_MIN_MINUTES && minutes <= REMINDER_MAX_MINUTES;
}

/** Sorted (soonest to the run first) with duplicates removed. */
export function normalizeReminderOffsets(offsets: readonly number[]): number[] {
  return [...new Set(offsets)].sort((a, b) => a - b);
}

export function reminderLabel(minutes: number): string {
  const parts: string[] = [];
  for (const [size, unit] of [[1440, 'day'], [60, 'hour'], [1, 'minute']] as const) {
    const count = Math.floor(minutes / size);
    if (count) parts.push(`${count} ${unit}${count === 1 ? '' : 's'}`);
    minutes %= size;
  }
  return parts.join(' ');
}

/** "1 day, 1 hour and 15 minutes": largest first. */
export function reminderListLabel(offsets: readonly number[]): string {
  const labels = normalizeReminderOffsets(offsets).reverse().map(reminderLabel);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0] ?? '';
}
