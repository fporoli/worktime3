/**
 * Formatting and parsing of numbers and dates in the app's language. Values are always stored
 * in one canonical form: numbers as JS numbers, dates as 'YYYY-MM-DD', date-times as ISO UTC.
 * Kept free of JSX so Node can import it in tests.
 */

/** The decimal and grouping separators `Intl` uses for a locale. */
export function numberSeparators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}

/**
 * Parses a number typed in the user's language. Returns `null` for empty input and `undefined`
 * when the text is not a number.
 *
 * Accepts both `.` and `,` as decimal separator, because people mix them (a Swiss user with the
 * German UI types `12.50`, a German one `12,50`):
 * - spaces and apostrophes (`1'234.50`, `1 234,50`) are always grouping;
 * - if both `.` and `,` occur, the last one is the decimal separator;
 * - a single separator kind occurring more than once is grouping (`1.234.567`);
 * - a single separator occurring once is decimal, unless it is the locale's grouping separator
 *   followed by exactly three digits (`1.234` in German is one thousand two hundred thirty-four).
 */
export function parseLocaleNumber(text: string, locale: string): number | null | undefined {
  let s = text.trim().replace(/[\s  '’]/g, '');
  if (s === '') return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    s = s.split(group).join('').replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const count = s.split(sep).length - 1;
    const digitsAfter = s.length - s.lastIndexOf(sep) - 1;
    const isGrouping = count > 1 || (sep === numberSeparators(locale).group && digitsAfter === 3);
    s = isGrouping ? s.split(sep).join('') : s.replace(sep, '.');
  }

  if (!/^[-+]?\d+(\.\d+)?$/.test(s) && !/^[-+]?\.\d+$/.test(s)) return undefined;
  return Number(s);
}

/** A number as the user's language writes it, e.g. 1234.5 -> "1.234,5" in German. */
export function formatLocaleNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 10 }).format(value);
}

/** A 'YYYY-MM-DD' date in the user's language; anything else is returned unchanged. */
export function formatLocaleDate(isoDate: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return isoDate;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(locale);
}

/** An ISO date-time in the user's language and time zone; an invalid value is returned unchanged. */
export function formatLocaleDateTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });
}

/** Formats non-negative minutes as "Xh YYm", e.g. 95 -> "1h 35m", 60 -> "1h 00m". */
export function formatDurationMinutes(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Formats signed minutes with explicit +/- prefix, e.g. -65 -> "-1h 05m", 90 -> "+1h 30m". */
export function formatSignedMinutes(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  return `${sign}${formatDurationMinutes(Math.abs(minutes))}`;
}

/** Formats byte sizes for attachments, e.g. 1536 -> "1.5 KB". */
export function formatFileSize(bytes: number, locale = 'en'): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}

/** Relative timestamp for notifications (falls back to localized date beyond 7 days). */
export function formatRelativeTime(iso: string, locale: string, nowMs = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffSec = Math.round((d.getTime() - nowMs) / 1000);
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absSec < 60) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  const diffHours = Math.round(diffMin / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) <= 7) return rtf.format(diffDays, 'day');
  return d.toLocaleDateString(locale);
}
