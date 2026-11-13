export const HOME_SOURCE_HEALTH_KEY = 'moku.homeSourceHealth.v1';
export const HOME_SOURCE_IDS = ['sogo', 'xin'];
const MAX_TIMESTAMP = 253402300799999; // 9999-12-31T23:59:59.999Z

export function normalizeHomeSourceHealth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const source of HOME_SOURCE_IDS) {
    const timestamp = value[source];
    if (Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp <= MAX_TIMESTAMP) result[source] = timestamp;
  }
  return result;
}

export function readHomeSourceHealth(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    const raw = target?.getItem(HOME_SOURCE_HEALTH_KEY);
    return raw ? normalizeHomeSourceHealth(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function recordHomeSourceSuccess(value, source, timestamp = Date.now()) {
  if (!HOME_SOURCE_IDS.includes(source) || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > MAX_TIMESTAMP) {
    return normalizeHomeSourceHealth(value);
  }
  return { ...normalizeHomeSourceHealth(value), [source]: timestamp };
}

export function formatHomeSourceFreshness(timestamp, now = Date.now()) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return 'Not updated yet';
  const age = Math.max(0, now - timestamp);
  if (age < 60_000) return 'Just now';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} min ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} hr ago`;
  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  if (sameDay(date, today)) return `Today at ${time}`;
  if (sameDay(date, yesterday)) return `Yesterday at ${time}`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}
