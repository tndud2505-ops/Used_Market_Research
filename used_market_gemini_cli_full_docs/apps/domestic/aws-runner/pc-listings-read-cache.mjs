// A public listing browse scans its whole scope. Reuse a recent first-page
// result, and recompute an aged scope at most once after the response instead
// of once per visitor. Concurrent misses share one scan. Scopes nobody opens are
// never computed.
export function createPcListingsReadCache({
  freshMs = 300_000,
  maxStaleMs = 3_600_000,
  maxEntries = 48,
  now = Date.now
} = {}) {
  const entries = new Map();
  const inflight = new Map();
  const store = (key, value) => {
    entries.delete(key);
    entries.set(key, { value, at: now() });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };
  const refresh = (key, compute) => {
    if (inflight.has(key)) return inflight.get(key);
    const job = Promise.resolve().then(compute).then((value) => { store(key, value); return value; })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  };
  return {
    async read(key, compute) {
      const entry = entries.get(key);
      const age = entry ? now() - entry.at : Infinity;
      if (entry && age <= maxStaleMs) {
        entries.delete(key);
        entries.set(key, entry);
        if (age <= freshMs) return { value: entry.value, state: "HIT" };
        refresh(key, compute).catch((error) => {
          console.warn("[aws-runner] PC listing background refresh failed", error?.message || error);
        });
        return { value: entry.value, state: "STALE" };
      }
      return { value: await refresh(key, compute), state: "MISS" };
    },
    clear() { entries.clear(); },
    get size() { return entries.size; }
  };
}
