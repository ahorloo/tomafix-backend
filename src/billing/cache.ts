// Simple per-workspace entitlements cache. Swap for Redis if needed.
type CacheValue<T> = { value: T; expiresAt: number };

const STORE = new Map<string, CacheValue<any>>();

export function cacheGet<T>(key: string): T | null {
  const hit = STORE.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    STORE.delete(key);
    return null;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number) {
  STORE.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheBust(key: string) {
  STORE.delete(key);
}

export function cacheStats() {
  const now = Date.now();
  let valid = 0;
  let expired = 0;
  for (const [, entry] of STORE.entries()) {
    if (entry.expiresAt >= now) valid += 1;
    else expired += 1;
  }
  return { size: STORE.size, valid, expired };
}
