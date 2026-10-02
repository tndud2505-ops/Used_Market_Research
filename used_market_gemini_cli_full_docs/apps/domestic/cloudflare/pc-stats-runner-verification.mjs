export async function verifyStatsWithRunner(env, publication) {
  if (!env.RUNNER_TOKEN || !env.RUNNER_URL) throw new Error('AWS verification is not configured');
  const url = new URL(env.RUNNER_URL);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid AWS verifier URL');
  url.pathname = '/api/runner/verify-stats-publication';
  url.search = ''; url.hash = '';
  // The caller cannot supply a verifier URL, proof, or skip flag.
  const response = await fetch(url, { method: 'POST', redirect: 'manual',
    headers: { authorization: `Bearer ${env.RUNNER_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(publication), signal: AbortSignal.timeout(95_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`AWS verification failed: HTTP_${response.status}`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('AWS verification response missing');
  const parts = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new Error('AWS verification response too large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const result = JSON.parse(new TextDecoder().decode(bytes));
  if (result.ok !== true) throw new Error('AWS verification rejected publication');
  return result.verification;
}
