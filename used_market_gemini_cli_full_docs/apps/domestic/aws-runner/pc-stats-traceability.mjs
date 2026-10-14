import { createHash } from "node:crypto";

function canonicalMember(member) {
  return {
    stat_date: String(member.stat_date || ""),
    metric_scope: String(member.metric_scope || ""),
    price_value: Number(member.price_value),
    outlier_flag: Number(member.outlier_flag || 0),
    outlier_reason: member.outlier_reason == null ? null : String(member.outlier_reason),
    snapshot_id: Number(member.snapshot_id),
    raw_listing_id: Number(member.raw_listing_id),
    source_id: String(member.source_id || ""),
    source_listing_id: String(member.source_listing_id || ""),
    listing_item_id: Number(member.listing_item_id)
  };
}

export function canonicalPcStatsTraceMembers(members) {
  return (Array.isArray(members) ? members : []).map(canonicalMember)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function pcStatsTraceability(ledger, options) {
  if (!ledger) throw new TypeError("ledger is required");
  // Serialize each member only once, rather than on every comparison in O(n log n) sorting.
  const members = [];
  for (const member of ledger.traceStatMembers(options, { iterate: true })) {
    members.push(JSON.stringify(canonicalMember(member)));
  }
  members.sort((left, right) => left.localeCompare(right));
  const checksum = createHash('sha256').update('[');
  for (let index = 0; index < members.length; index++) {
    if (index) checksum.update(',');
    checksum.update(members[index]);
  }
  return {
    member_count: members.length,
    member_checksum: checksum.update(']').digest('hex')
  };
}
