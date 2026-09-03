import { createHash } from "node:crypto";

export function canonicalPcStatsTraceMembers(members) {
  return (Array.isArray(members) ? members : []).map((member) => ({
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
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function pcStatsTraceability(ledger, options) {
  if (!ledger) throw new TypeError("ledger is required");
  const members = canonicalPcStatsTraceMembers(ledger.traceStatMembers(options));
  return {
    member_count: members.length,
    member_checksum: createHash("sha256").update(JSON.stringify(members)).digest("hex")
  };
}
