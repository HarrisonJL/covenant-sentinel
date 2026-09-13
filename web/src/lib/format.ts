export function truncateAddress(address: string, chars = 4): string {
  if (!address || address.length < 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function timeAgo(isoString: string): string {
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return isoString;
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Renders a basis-points-scaled value (threshold_bps, extracted figures) as a decimal, e.g. 12500 -> "1.25x". */
export function formatBps(value: number | bigint | string): string {
  const v = typeof value === "bigint" ? value : BigInt(value);
  const whole = v / 10000n;
  const frac = v % 10000n;
  if (frac === 0n) return `${whole}x`;
  const fracStr = frac.toString().padStart(4, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}x`;
}

export function formatSeconds(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${seconds}s`;
}
