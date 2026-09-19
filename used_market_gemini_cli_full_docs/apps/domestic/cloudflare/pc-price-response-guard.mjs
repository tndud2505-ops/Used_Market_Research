import { parsePriceStatsRequest } from '../aws-runner/pc-price-stats-http.mjs';
import { isLatestCompletedDailyPublication, pcPriceReadinessProblem } from '../market/logic/pc-price-readiness.mjs';

export async function guardPriceStatsResponse(request, response) {
  if (response.status !== 200) return response;
  let query;
  try { query = parsePriceStatsRequest(new URL(request.url)); } catch { return response; }
  let payload;
  try { payload = await response.clone().json(); } catch { return response; }
  const data = payload?.data ?? payload;
  const latestCompletedDailyPublication = isLatestCompletedDailyPublication(query, data);
  const problem = pcPriceReadinessProblem(query, data);
  if (!problem) {
    if (!latestCompletedDailyPublication) return response;
    const updatedData = {
      ...data,
      availability: {
        ...(data?.availability || {}),
        status: 'LAST_PUBLISHED',
        reason: 'LATEST_COMPLETE_DAILY_PUBLICATION',
        counts_are_unique_period_listings: true
      }
    };
    const updatedPayload = payload?.data ? { ...payload, data: updatedData } : updatedData;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.delete('etag');
    return new Response(JSON.stringify(updatedPayload), { status: response.status, statusText: response.statusText, headers });
  }
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
