import { MarketSnapshotSchema, type MergeResult, type MergedItem, type PriceWindowStats } from "../../MCP/logic/types.js";
import { trace } from "../../MCP/logic/runtime-trace.js";
import { classifyNoiseCandidate, type NoiseFilterReason } from "./noise-filter.js";
import { buildRamAwareComponentKey } from "./ram-brand.js";

const WINDOWS = [7, 30, 60, 90];
const KOREA_TIME_OFFSET = "+09:00";

type PricePoint = {
  price: number;
  postedAt: Date | null;
};

type SnapshotBucket = {
  componentKey: string;
  componentType: string;
  listingScope: "full_pc" | "semi_pc" | "part" | "unknown";
};

type PartReferenceRule = {
  maxObservedAgeDays: number;
  requireSingleConsumerComponent: boolean;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(sortedValues: number[], percentileValue: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0] ?? null;

  const position = (sortedValues.length - 1) * percentileValue;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex] ?? sortedValues[0] ?? 0;
  const upper = sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1] ?? lower;

  if (lowerIndex === upperIndex) {
    return lower;
  }

  const ratio = position - lowerIndex;
  return lower + ((upper - lower) * ratio);
}

function clampOutlierFence(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function medianAbsoluteDeviation(sortedValues: number[], medianValue: number) {
  const deviations = sortedValues
    .map((value) => Math.abs(value - medianValue))
    .sort((left, right) => left - right);
  return percentile(deviations, 0.5);
}

function resolvePartRatioBounds(componentType: string, medianValue: number) {
  if (componentType === "ram") {
    return { lower: medianValue * 0.6, upper: medianValue * 1.85 };
  }

  if (componentType === "cpu") {
    return { lower: medianValue * 0.55, upper: medianValue * 1.8 };
  }

  if (componentType === "gpu") {
    return { lower: medianValue * 0.5, upper: medianValue * 1.95 };
  }

  if (componentType === "ssd" || componentType === "motherboard") {
    return { lower: medianValue * 0.55, upper: medianValue * 1.9 };
  }

  return { lower: medianValue * 0.45, upper: medianValue * 2.2 };
}

function filterPartPriceOutliers(bucket: SnapshotBucket, values: number[]): number[] {
  if (values.length < 3) {
    return [...values];
  }

  const sorted = [...values].sort((left, right) => left - right);
  const medianValue = percentile(sorted, 0.5);
  if (medianValue === null || medianValue <= 0) {
    return sorted;
  }

  const ratioBounds = resolvePartRatioBounds(bucket.componentType, medianValue);
  const ratioLowerBound = ratioBounds.lower;
  const ratioUpperBound = ratioBounds.upper;

  let lowerFence = ratioLowerBound;
  let upperFence = ratioUpperBound;

  if (sorted.length >= 4) {
    const q1 = percentile(sorted, 0.25);
    const q3 = percentile(sorted, 0.75);
    if (q1 !== null && q3 !== null) {
      const iqr = q3 - q1;
      if (iqr > 0) {
        lowerFence = Math.max(ratioLowerBound, clampOutlierFence(q1 - (iqr * 1.5), ratioLowerBound));
        upperFence = Math.min(ratioUpperBound, clampOutlierFence(q3 + (iqr * 1.5), ratioUpperBound));
      }
    }
  }

  const mad = medianAbsoluteDeviation(sorted, medianValue);
  if (mad !== null && mad > 0) {
    const robustSigma = mad * 1.4826;
    lowerFence = Math.max(lowerFence, medianValue - (robustSigma * 4));
    upperFence = Math.min(upperFence, medianValue + (robustSigma * 4));
  }

  const filtered = sorted.filter((price) => price >= lowerFence && price <= upperFence);
  const minimumRetainedCount = Math.max(2, Math.ceil(sorted.length * 0.5));
  if (filtered.length < minimumRetainedCount) {
    return sorted;
  }

  return filtered;
}

function prepareWindowValues(
  bucket: SnapshotBucket,
  values: number[]
) {
  if (bucket.listingScope !== "part") {
    return values;
  }

  return filterPartPriceOutliers(bucket, values);
}

function isGenericSsdBucket(bucket: SnapshotBucket) {
  return bucket.listingScope === "part"
    && bucket.componentType === "ssd"
    && /^SSD (?:256GB|500GB|1TB|2TB)$/i.test(bucket.componentKey);
}

function computeWindowReferencePrice(bucket: SnapshotBucket, values: number[]) {
  if (values.length === 0) {
    return null;
  }

  if (isGenericSsdBucket(bucket)) {
    const sorted = [...values].sort((left, right) => left - right);
    const lowerMarketPercentile = percentile(sorted, 0.35);
    if (lowerMarketPercentile !== null) {
      return Math.round(lowerMarketPercentile);
    }
  }

  return average(values);
}

function parsePostedAt(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed}T00:00:00${KOREA_TIME_OFFSET}`);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed.replace(" ", "T") + KOREA_TIME_OFFSET);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseObservedAt(item: Pick<MergedItem, "posted_at" | "upload_date">): Date | null {
  return parsePostedAt(item.posted_at) ?? parsePostedAt(item.upload_date);
}

function getListingScope(item: Pick<MergedItem, "listing_type">): SnapshotBucket["listingScope"] {
  if (item.listing_type === "part" || item.listing_type === "full_pc" || item.listing_type === "semi_pc") {
    return item.listing_type;
  }
  return "unknown";
}

function isConsumerComponentType(componentType: string) {
  return componentType === "cpu"
    || componentType === "gpu"
    || componentType === "ram"
    || componentType === "ssd"
    || componentType === "motherboard"
    || componentType === "psu";
}

function getPartReferenceRule(bucket: SnapshotBucket): PartReferenceRule | null {
  if (bucket.listingScope !== "part") {
    return null;
  }

  if (isConsumerComponentType(bucket.componentType)) {
    return {
      maxObservedAgeDays: 60,
      requireSingleConsumerComponent: true
    };
  }

  return null;
}

function normalizeBucketToken(value: string) {
  return value
    .toLowerCase()
    .replace(/^nvidia\s+/i, "")
    .replace(/^amd\s+radeon\s+/i, "")
    .replace(/^amd\s+/i, "")
    .replace(/^intel\s+core\s+/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function buildSnapshotComponentKey(
  item: Pick<MergedItem, "title" | "raw_notes" | "detail_excerpt" | "listing_type">,
  component: MergedItem["components"][number]
) {
  if (item.listing_type !== "part") {
    return component.canonical_name;
  }

  return buildRamAwareComponentKey(component, item.title, item.raw_notes, item.detail_excerpt);
}

function shouldExcludeFromSnapshot(
  item: Pick<MergedItem, "title" | "raw_notes" | "listing_type" | "components" | "price_value" | "seller_upload_count" | "noise_filtered" | "noise_filter_reason" | "detail_excerpt" | "item_status" | "sale_status" | "posted_at" | "upload_date">
): NoiseFilterReason | null {
  if (item.noise_filtered && item.noise_filter_reason) {
    return item.noise_filter_reason as NoiseFilterReason;
  }
  return classifyNoiseCandidate(item);
}

function selectPartAnchor(
  item: Pick<MergedItem, "components" | "listing_type" | "title" | "raw_notes" | "detail_excerpt">,
  keyword: string
): SnapshotBucket {
  const listingScope = getListingScope(item);
  const normalizedKeyword = normalizeBucketToken(keyword);
  const keywordMatched = item.components.find((component) => {
    const token = normalizeBucketToken(buildSnapshotComponentKey(item, component));
    return token.length > 0 && (
      normalizedKeyword === token
      || normalizedKeyword.includes(token)
      || token.includes(normalizedKeyword)
    );
  });

  if (keywordMatched) {
    return {
      componentKey: buildSnapshotComponentKey(item, keywordMatched),
      componentType: keywordMatched.component_type,
      listingScope
    };
  }

  const priority = ["gpu", "cpu", "ram", "ssd", "motherboard", "psu"];
  for (const componentType of priority) {
    const match = item.components.find((component) => component.component_type === componentType);
    if (match) {
      return {
        componentKey: buildSnapshotComponentKey(item, match),
        componentType: match.component_type,
        listingScope
      };
    }
  }

  return {
    componentKey: keyword,
    componentType: "unknown",
    listingScope
  };
}

function selectBundleAnchor(item: Pick<MergedItem, "components" | "listing_type">, keyword: string): SnapshotBucket {
  const gpuComponent = item.components.find((component) => component.component_type === "gpu");
  if (gpuComponent) {
    return {
      componentKey: gpuComponent.canonical_name,
      componentType: gpuComponent.component_type,
      listingScope: getListingScope(item)
    };
  }

  const cpuComponent = item.components.find((component) => component.component_type === "cpu");
  if (cpuComponent) {
    return {
      componentKey: cpuComponent.canonical_name,
      componentType: cpuComponent.component_type,
      listingScope: getListingScope(item)
    };
  }

  return {
    componentKey: keyword,
    componentType: "bundle",
    listingScope: getListingScope(item)
  };
}

function pickSnapshotBucket(
  item: Pick<MergedItem, "components" | "listing_type" | "title" | "raw_notes" | "detail_excerpt">,
  keyword: string
): SnapshotBucket {
  const listingScope = getListingScope(item);

  if (listingScope === "part") {
    if (item.components.length === 0) {
      return {
        componentKey: keyword,
        componentType: "unknown",
        listingScope
      };
    }

    return selectPartAnchor(item, keyword);
  }

  return selectBundleAnchor(item, keyword);
}

function isEligiblePartReferenceObservation(
  item: Pick<MergedItem, "components" | "listing_type" | "posted_at" | "upload_date" | "title" | "raw_notes" | "detail_excerpt">,
  bucket: SnapshotBucket,
  referenceTime: number,
  postedAt: Date | null
) {
  const rule = getPartReferenceRule(bucket);
  if (!rule) {
    return true;
  }

  if (!postedAt) {
    return false;
  }

  const ageMs = referenceTime - postedAt.getTime();
  if (ageMs > rule.maxObservedAgeDays * 24 * 60 * 60 * 1000) {
    return false;
  }

  if (!rule.requireSingleConsumerComponent) {
    return true;
  }

  const consumerComponents = item.components.filter((component) => isConsumerComponentType(component.component_type));
  const referenceComponents = consumerComponents.filter((component) =>
    component.source_kind !== "search_notes"
    || component.evidence_level === "confirmed"
    || component.confidence >= 0.9
  );
  const effectiveComponents = referenceComponents.length > 0 ? referenceComponents : consumerComponents;
  const distinctConsumerComponents = new Set(
    effectiveComponents.map((component) => `${component.component_type}:${buildSnapshotComponentKey(item, component)}`)
  );
  const targetComponents = effectiveComponents.filter((component) =>
    component.component_type === bucket.componentType
    && buildSnapshotComponentKey(item, component) === bucket.componentKey
  );

  return targetComponents.length >= 1 && distinctConsumerComponents.size === 1;
}

export function buildMarketSnapshot(keyword: string, merged: MergeResult) {
  trace("market.snapshot:start", { keyword, merged_items: merged.merged_items.length });
  const eligibleEntries: Array<{
    item: Pick<MergedItem, "components" | "listing_type" | "posted_at" | "upload_date" | "title" | "raw_notes" | "detail_excerpt">;
    bucket: SnapshotBucket;
    point: PricePoint;
  }> = [];
  const observedTimes: number[] = [];
  const excludedReasons = new Map<NoiseFilterReason, number>();

  for (const item of merged.merged_items) {
    const excludedReason = shouldExcludeFromSnapshot(item);
    if (excludedReason) {
      excludedReasons.set(excludedReason, (excludedReasons.get(excludedReason) ?? 0) + 1);
      continue;
    }

    const price = item.price_value;
    if (price === null) continue;

    const postedAt = parseObservedAt(item);
    if (postedAt) {
      observedTimes.push(postedAt.getTime());
    }

    eligibleEntries.push({
      item,
      bucket: pickSnapshotBucket(item, keyword),
      point: { price, postedAt }
    });
  }

  const referenceTime = observedTimes.length > 0 ? Math.max(...observedTimes) : Date.now();
  const priceByComponent = new Map<string, { bucket: SnapshotBucket; points: PricePoint[] }>();

  for (const entry of eligibleEntries) {
    if (!isEligiblePartReferenceObservation(entry.item, entry.bucket, referenceTime, entry.point.postedAt)) {
      continue;
    }

    const mapKey = `${entry.bucket.listingScope}:${entry.bucket.componentType}:${entry.bucket.componentKey}`;
    if (!priceByComponent.has(mapKey)) {
      priceByComponent.set(mapKey, {
        bucket: entry.bucket,
        points: []
      });
    }
    priceByComponent.get(mapKey)!.points.push(entry.point);
  }

  const windows: PriceWindowStats[] = [];
  for (const { bucket, points } of priceByComponent.values()) {
    for (const windowDays of WINDOWS) {
      const values = points
        .filter(({ postedAt }) => postedAt === null || referenceTime - postedAt.getTime() <= windowDays * 24 * 60 * 60 * 1000)
        .map(({ price }) => price);
      const preparedValues = prepareWindowValues(bucket, values);
      const referencePrice = computeWindowReferencePrice(bucket, preparedValues);

      windows.push({
        component_key: bucket.componentKey,
        component_type: bucket.componentType,
        listing_scope: bucket.listingScope,
        window_days: windowDays,
        average_price: referencePrice,
        sample_count: preparedValues.length,
        trade_estimate: referencePrice !== null ? Math.round(referencePrice * 0.95) : null
      });
    }
  }

  const result = MarketSnapshotSchema.parse({
    keyword,
    windows,
    notes: [
      "Market snapshot keeps part listings separate from full_pc and semi_pc bundle pricing.",
      "Part component windows are built from part listings only; bundle pricing is anchored under full_pc or semi_pc scope.",
        "Market snapshot uses collected listing averages filtered by observed time relative to the newest captured listing.",
        "Observed time prefers posted_at and falls back to upload_date when the source only exposes coarse listing month data.",
      "Trade estimates are a simple 95 percent approximation and should be refined with fee and transaction history data.",
      ...(
        excludedReasons.size > 0
          ? [
              `Noise filter excluded ${Array.from(excludedReasons.values()).reduce((sum, count) => sum + count, 0)} listings before price windows: ${
                Array.from(excludedReasons.entries())
                  .sort((left, right) => right[1] - left[1])
                  .map(([reason, count]) => `${reason}=${count}`)
                  .join(", ")
              }.`
            ]
          : []
      )
    ]
  });

  trace("market.snapshot:complete", { keyword, windows: result.windows.length });
  return result;
}
