import { canonicalSourceListingToken } from './pc-source-listing-identity.mjs';

const HOUR = 3600000;
function identity(source, item) {
  if (!['bunjang', 'joonggonara'].includes(source) || item?.site !== source) return null;
  try {
    const token = canonicalSourceListingToken(source, item.source_listing_id);
    const url = new URL(item.url);
    const hosts = source === 'bunjang' ? ['m.bunjang.co.kr', 'bunjang.co.kr'] : ['web.joongna.com', 'joongna.com'];
    const path = source === 'bunjang' ? `/products/${token}` : `/product/${token}`;
    if (!/^\d+$/u.test(token) || url.protocol !== 'https:' || !hosts.includes(url.hostname)
      || url.port || url.username || url.password || url.pathname.replace(/\/$/u, '') !== path
      || item.item_id !== `${source}:${token}`) return null;
    return token;
  } catch { return null; }
}

// Only positive, fresh rows already paid for by the ordinary search request.
// Absence from a page never changes a listing's state.
export async function reconcileSearchStatusObservations({
  source, observations = [], normalItems = [], db, recordItem, now = Date.now(),
  deadline = now + 8 * 60 * 1000, limit = 200, canContinue = () => true,
  observedAfter = now - 2 * HOUR, yieldControl = async () => {}
}) {
  const receipt = { seen: observations.length, eligible: 0, checked: 0, sold: 0, overdue_24h_checked: 0 };
  const projections = [];
  if (!['bunjang', 'joonggonara'].includes(source)) return { receipt, projections };
  const excluded = new Set(normalItems.map(item => identity(source, item)).filter(Boolean));
  const newest = new Map();
  for (const observation of observations) {
    const item = observation?.item, token = identity(source, item);
    const at = Date.parse(observation?.observed_at || '');
    if (!token || excluded.has(token) || !Number.isFinite(at) || at > now || at < observedAfter || now - at > 2 * HOUR
      || !['ACTIVE', 'RESERVED', 'SOLD', 'DELETED'].includes(item.status)) continue;
    const previous = newest.get(token);
    if (!previous || at > previous.at) newest.set(token, { ...observation, at });
    else if (at === previous.at && ['status', 'title', 'price', 'currency', 'description', 'source_listing_id']
      .some(key => item[key] !== previous.item[key])) previous.conflict = true;
  }
  const lookup = db.prepare(`SELECT lifecycle_status,last_checked_at,last_attempt_at
    FROM pc_lifecycle_queue WHERE source_id=? AND source_listing_id=?`);
  const eligible = observation => {
    if (observation.conflict || Date.now() - observation.at > 2 * HOUR) return null;
    const row = lookup.get(source, observation.item.source_listing_id);
    if (!row || !['ACTIVE', 'RESERVED', ...(source === 'bunjang' ? ['UNAVAILABLE_UNKNOWN'] : [])].includes(row.lifecycle_status)
      || observation.at <= Date.parse(row.last_checked_at)
      || observation.at <= Date.parse(row.last_attempt_at || '')
      || (row.lifecycle_status === observation.item.status && now - Date.parse(row.last_checked_at) < 6 * HOUR)) return null;
    return row;
  };
  const candidates = [...newest.values()].map(observation => ({ observation, row: eligible(observation) }))
    .filter(entry => entry.row).sort((a, b) => Date.parse(a.row.last_checked_at) - Date.parse(b.row.last_checked_at));
  receipt.eligible = candidates.length;
  for (const { observation } of candidates.slice(0, Math.max(0, Math.min(200, limit)))) {
    if (!canContinue() || Date.now() >= deadline) break;
    const row = eligible(observation); // Other ordinary work may have checked it while yielding.
    if (!row) continue;
    const projection = recordItem(observation.item, observation.observed_at);
    if (projection) projections.push(projection);
    receipt.checked += 1;
    if (observation.item.status === 'SOLD') receipt.sold += 1;
    if (now - Date.parse(row.last_checked_at) >= 24 * HOUR) receipt.overdue_24h_checked += 1;
    await yieldControl();
  }
  return { receipt, projections };
}
