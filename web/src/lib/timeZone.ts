/** The browser's IANA time zone. In its own module so tests can stub it. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
