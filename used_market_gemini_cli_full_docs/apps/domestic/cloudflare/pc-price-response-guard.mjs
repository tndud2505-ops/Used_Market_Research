import { parsePriceStatsRequest } from '../aws-runner/pc-price-stats-http.mjs';
import { pcPriceReadinessProblem } from '../market/logic/pc-price-readiness.mjs';

export async function guardPriceStatsResponse(request, response) {
  if (response.status !== 200) return response;
  let query;
  try { query = parsePriceStatsRequest(new URL(request.url)); } catch { return response; }
  let payload;
  try { payload = await response.clone().json(); } catch { return response; }
  const data = payload?.data ?? payload;
  const problem = pcPriceReadinessProblem(query, data);
  if (!problem) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.delete('etag');
  headers.delete('age');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-pc-price-readiness', 'unavailable');
  // Do not attach the incomplete metric payload or silently borrow today's
  // publication. This also protects cached responses from an older Runner.
  return new Response(JSON.stringify({ status: 'error', error: problem.code,
    availability: { status: 'UNAVAILABLE', ...problem } }), { status: 503, headers });
}
