import type { HTMLAttributes } from "react";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const units = [
  { unit: "minute", ms: 60_000, limit: 60 },
  { unit: "hour", ms: 3_600_000, limit: 24 },
  { unit: "day", ms: 86_400_000, limit: 7 },
] as const;

/** Recent instants read as "6 minutes ago"; older ones as a short date. */
export function relativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const delta = date.getTime() - now;
  if (Math.abs(delta) < 60_000) return "just now";
  for (const { unit, ms, limit } of units) {
    const value = Math.round(delta / ms);
    if (Math.abs(value) < limit) return relative.format(value, unit);
  }
  return date.toLocaleDateString(undefined, {
    month: "short", day: "numeric", ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

export interface RelativeTimeProps extends Omit<HTMLAttributes<HTMLTimeElement>, "children"> { value: string }
/** The exact local timestamp stays available as the tooltip. */
export function RelativeTime({ value, ...props }: RelativeTimeProps) {
  return <time {...props} dateTime={value} title={new Date(value).toLocaleString()}>{relativeTime(value)}</time>;
}

const byteUnits = ["bytes", "KB", "MB", "GB", "TB"] as const;
export function formatBytes(bytes: number): string {
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < byteUnits.length - 1) { value /= 1024; index++; }
  return index === 0 ? `${bytes.toLocaleString()} bytes` : `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${byteUnits[index]}`;
}
