// Time helpers. The pipeline runs on UTC; every human-facing stamp is shown in
// Eastern time (the publisher's clock for the civic sources) with UTC alongside.

export const ET_ZONE = 'America/New_York';

const etDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const etStampFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE,
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

const utcStampFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZoneName: 'short',
});

/** YYYY-MM-DD in UTC. */
export function isoDate(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

/** Full ISO-8601 timestamp with seconds. */
export function isoStamp(date = new Date()) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** YYYY-MM-DD in Eastern time. */
export function etDate(date = new Date()) {
  const parts = etDateFormatter.formatToParts(new Date(date));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** e.g. "November 4, 2026, 4:12 AM EST" */
export function formatEt(date) {
  if (!date) return 'never';
  return etStampFormatter.format(new Date(date));
}

/** e.g. "Nov 4, 2026, 09:12 UTC" */
export function formatUtc(date) {
  if (!date) return 'never';
  return utcStampFormatter.format(new Date(date));
}

/** Short label for a UTC date string, e.g. "Nov 4". */
export function shortDate(dateStr) {
  if (!dateStr) return '';
  const [year, month, day] = String(dateStr).split('-').map(Number);
  if (!year || !month || !day) return String(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[month - 1]} ${day}`;
}

export function addDays(dateOrString, days) {
  const base = dateOrString instanceof Date ? new Date(dateOrString) : new Date(`${dateOrString}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return isoDate(base);
}

/** Number of whole days between two YYYY-MM-DD strings (b - a). */
export function daysBetween(a, b) {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86400000);
}
