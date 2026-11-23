/**
 * Fixed-window rate limiter (Phase 3.1 §A3.3).
 * In-memory and per server instance: on serverless hosts each instance counts separately, so this
 * is abuse damping for the demo, not a hard quota. Production would use a shared store.
 */
import { ApiError } from "./problem";

const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs = 60_000): void {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return;
  }
  w.count++;
  if (w.count > limit) {
    const retry = Math.ceil((w.start + windowMs - now) / 1000);
    throw new ApiError(429, "RATE_LIMITED", `Limit is ${limit} requests per minute.`, undefined, { "retry-after": String(retry) });
  }
}

export function __resetRateLimitsForTests() {
  windows.clear();
}
