// A public listing browse scans its whole scope. Reuse a recent first-page
// result, and recompute an aged scope at most once after the response instead
// of once per visitor. Concurrent misses share one scan. The most recently
// requested scopes are also kept warm, so a visitor after a quiet period or a
// restart does not wait for the scan. Scopes nobody opens are never computed.
export function createPcListingsReadCache({
  freshMs = 300_000,
  maxStaleMs = 3_600_000,
  maxEntries = 48,
  now = Date.now
} = {}) {
  const entries = new Map();
  const inflight = new Map();
  const store = (key, value, compute, accessedAt) => {
    entries.delete(key);
    entries.set(key, { value, at: now(), compute, accessedAt });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };
  // compute({ waiting }) tells the scan whether a visitor is waiting for it.
  const refresh = (key, compute, accessedAt, waiting = false) => {
    if (inflight.has(key)) return inflight.get(key);
    const job = Promise.resolve().then(() => compute({ waiting }))
      .then((value) => { store(key, value, compute, entries.get(key)?.accessedAt ?? accessedAt); return value; })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  };
  const background = (key, compute, accessedAt) => refresh(key, compute, accessedAt).catch((error) => {
    console.warn("[aws-runner] PC listing background refresh failed", error?.message || error);
  });
  const recent = ({ recentMs, limit }) => [...entries.entries()]
    .filter(([, entry]) => now() - entry.accessedAt <= recentMs)
    .sort((left, right) => right[1].accessedAt - left[1].accessedAt)
    .slice(0, limit);
  return {
    async read(key, compute) {
      const entry = entries.get(key);
      const age = entry ? now() - entry.at : Infinity;
      if (entry && age <= maxStaleMs) {
        entries.delete(key);
        entry.compute = compute;
        entry.accessedAt = now();
        entries.set(key, entry);
        if (age <= freshMs) return { value: entry.value, state: "HIT" };
        background(key, compute, entry.accessedAt);
        return { value: entry.value, state: "STALE" };
      }
      return { value: await refresh(key, compute, now(), true), state: "MISS" };
    },
    // Refresh recently requested scopes before a visitor finds them aged.
    keepWarm({ refreshAfterMs = 600_000, recentMs = 21_600_000, limit = 12 } = {}) {
      let started = 0;
      for (const [key, entry] of recent({ recentMs, limit })) {
        if (now() - entry.at < refreshAfterMs || inflight.has(key)) continue;
        background(key, entry.compute, entry.accessedAt);
        started += 1;
      }
      return started;
    },
    recentKeys({ recentMs = 21_600_000, limit = 12 } = {}) {
      return recent({ recentMs, limit }).map(([key]) => key);
    },
    // Compute a remembered scope without a waiting visitor (startup warm-up).
    prime(key, compute) {
      if (entries.has(key) || inflight.has(key)) return;
      background(key, compute, now());
    },
    clear() { entries.clear(); },
    get size() { return entries.size; }
  };
}
