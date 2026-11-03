// Detailed sale-status requests are approved only for Joonggonara. Ordinary
// scheduled search observations and retained history use their existing paths.
export function lifecycleRecheckEnabled(sourceId) {
  return sourceId === 'joonggonara';
}

// Overlap only bounded I/O; all verified state changes remain in the caller.
export async function runLifecycleBatch(items, { concurrency = 1, canStart, processItem }) {
  let cursor = 0, failure = null;
  const worker = async () => {
    try {
      while (!failure && cursor < items.length && canStart()) {
        const item = items[cursor++];
        await processItem(item);
      }
    } catch (error) { failure ||= error; }
  };
  await Promise.all(Array.from({ length: Math.min(2, Math.max(1, concurrency)) }, worker));
  // Wait for every already-started operation before projecting results or releasing the job.
  if (failure) throw failure;
}

export function pacedLifecycleFetch(fetchImpl, {
  intervalMs = 200, canStart, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  let admission = Promise.resolve(), lastStartedAt = -Infinity;
  return async (input, init) => {
    let response;
    const start = admission.then(async () => {
      const delay = lastStartedAt + intervalMs - now();
      if (delay > 0) await sleep(delay);
      if (!canStart()) {
        const error = new Error('LIFECYCLE_ADMISSION_STOPPED');
        error.code = 'LIFECYCLE_ADMISSION_STOPPED';
        throw error;
      }
      lastStartedAt = now();
      response = fetchImpl(input, init);
      // A response may reject while this admission promise is being handed back.
      response.catch(() => {});
    });
    admission = start.catch(() => {});
    await start;
    return response;
  };
}
