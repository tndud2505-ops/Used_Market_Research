import type { MergedItem, NormalizedItem } from "../../MCP/logic/types.js";

interface ComponentPrice {
  [key: string]: number;
}

type ItemForDecomposeCheck = Pick<NormalizedItem, "price_value" | "listing_type" | "components"> & {
  baseline_price?: MergedItem["baseline_price"];
};

const COMPONENT_RESALE_PRICES: ComponentPrice = {
  gpu: 300000,
  cpu: 150000,
  ram: 50000,
  ssd: 80000,
  psu: 50000,
  case: 30000,
  motherboard: 80000,
  cooler: 20000,
  hdd: 20000
};

export function analyzeDecomposition(
  item: ItemForDecomposeCheck,
  componentPrices: Partial<ComponentPrice> = {}
): {
  as_is_price: number | null;
  decomposed_total: number | null;
  decompose_cost: number;
  decompose_recommendation: "keep" | "decompose" | null;
} {
  const prices = { ...COMPONENT_RESALE_PRICES, ...componentPrices };

  if (item.listing_type !== "full_pc") {
    return {
      as_is_price: null,
      decomposed_total: null,
      decompose_cost: 20000,
      decompose_recommendation: null
    };
  }

  const asIsPrice = item.price_value ?? item.baseline_price ?? 0;
  let decomposedTotal = 0;

  for (const component of item.components) {
    const componentType = component.component_type.toLowerCase();
    const componentPrice = prices[componentType];
    if (componentPrice !== undefined) {
      decomposedTotal += componentPrice * component.confidence;
    }
  }

  const decomposeCost = 20000;
  let recommendation: "keep" | "decompose" | null = null;

  if (asIsPrice > 0) {
    const decomposeProfitAfterCost = decomposedTotal - decomposeCost;
    const profitGain = decomposeProfitAfterCost - asIsPrice;
    const gainRatio = profitGain / asIsPrice;
    recommendation = gainRatio > 0.3 ? "decompose" : "keep";
  }

  return {
    as_is_price: asIsPrice || null,
    decomposed_total: Math.round(decomposedTotal) || null,
    decompose_cost: decomposeCost,
    decompose_recommendation: recommendation
  };
}
