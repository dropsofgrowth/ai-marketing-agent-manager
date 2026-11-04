/**
 * Small in-process cache for read-only API results. Concurrent callers for the
 * same key share one in-flight promise, and failures are never cached. Per server
 * instance only — it reduces API calls and rate-limit pressure, it is not a store.
 */
export type TtlCache = {
  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  /** Drops every entry whose key starts with `prefix` (e.g. after disconnecting). */
  clear(prefix?: string): void;
};

export function createTtlCache(maxEntries = 300, now: () => number = Date.now): TtlCache {
  const entries = new Map<string, { expires: number; value: Promise<unknown> }>();

  return {
    get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value as Promise<T>;

      const value = load();
      entries.set(key, { expires: now() + ttlMs, value });
      value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
      return value;
    },
    clear(prefix) {
      if (!prefix) return entries.clear();
      for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
    },
  };
}
