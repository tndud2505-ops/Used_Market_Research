export async function probeRunnerReadiness(env, fetcher = fetch) {
  const start = Date.now();
  if (!env.RUNNER_URL || !env.RUNNER_TOKEN) return { ok: false, error: 'RUNNER_NOT_CONFIGURED' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    // A category query computes counts across every matching listing even with
    // limit=1. Probe the same authenticated read path using its product index.
    const url = new URL('/api/pc/listings?canonical_product_id=cpu%3Aintel%3Ai5-9600k&limit=1', env.RUNNER_URL);
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${env.RUNNER_TOKEN}`, accept: 'application/json', 'cache-control': 'no-store' },
      signal: controller.signal, redirect: 'manual'
    });
    const body = await response.json();
    if (!response.ok || body.status !== 'success' || !Array.isArray(body.data?.items)) throw new Error('Not ready');
    return { ok: true, read_path: 'pc_listings', elapsed_ms: Date.now() - start };
  } catch { return { ok: false, error: 'RUNNER_READ_UNAVAILABLE', elapsed_ms: Date.now() - start }; }
  finally { clearTimeout(timer); }
}
