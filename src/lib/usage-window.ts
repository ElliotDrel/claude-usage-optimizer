export function normalizeResetHour(resetAt: string | null): string | null {
  if (!resetAt) return null;

  const ms = Date.parse(resetAt);
  if (Number.isNaN(ms)) return resetAt;

  const normalized = new Date(ms);
  normalized.setUTCMinutes(0, 0, 0);
  return normalized.toISOString();
}

export function isSameUsageWindow(
  prevResetAt: string | null,
  currResetAt: string | null
): boolean {
  return normalizeResetHour(prevResetAt) === normalizeResetHour(currResetAt);
}

export function computeUsageDelta(
  prevUtil: number | null,
  currUtil: number | null,
  prevResetAt: string | null,
  currResetAt: string | null
): number {
  if (currUtil == null) return 0;
  if (prevUtil == null) return currUtil;

  if (!isSameUsageWindow(prevResetAt, currResetAt)) {
    return currUtil;
  }

  return Math.max(0, currUtil - prevUtil);
}
