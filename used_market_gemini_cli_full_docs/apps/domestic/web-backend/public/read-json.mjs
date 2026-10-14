// Read-only requests get one bounded recovery attempt. Never retry user cancellation,
// semantic errors, authentication failures, or writes.
export async function readJsonResponse(url, { signal, cache = 'no-cache', timeoutMs = 20000,
  retryDelayMs = 500 } = {}) {
  const abortError = () => signal?.reason || new DOMException('Aborted', 'AbortError');
  const delay = () => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, retryDelayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw abortError();
    const request = new AbortController();
    let timedOut = false;
    const abort = () => request.abort(abortError());
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, timeoutMs);
    let retry = false;
    try {
      const response = await fetch(url, { method: 'GET', signal: request.signal,
        credentials: 'same-origin', cache, headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(error => {
        if (request.signal.aborted || error instanceof TypeError) throw error;
        return null;
      });
      if (signal?.aborted) throw abortError();
      const code = payload?.error?.code || payload?.code
        || (typeof payload?.error === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(payload.error));
      retry = attempt === 0 && [502, 504].includes(response.status) && !code;
      if (!retry) return { response, payload };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      retry = attempt === 0 && (timedOut || error instanceof TypeError);
      if (!retry) {
        if (timedOut || error instanceof TypeError) {
          const unavailable = new Error('연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
          unavailable.code = timedOut ? 'LOOKUP_TIMEOUT' : 'LOOKUP_NETWORK_ERROR';
          throw unavailable;
        }
        throw error;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
    await delay();
  }
}
