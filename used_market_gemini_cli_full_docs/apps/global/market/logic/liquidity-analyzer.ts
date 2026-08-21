import type { NormalizedItem } from "../../MCP/logic/types.js";

interface LiquidityContext {
  similar_items_sold_7d?: number;
  component_popularity?: "high" | "medium" | "low";
}

type ItemForLiquidityCheck = Pick<NormalizedItem, "price_value" | "listing_type" | "components">;

export function analyzeLiquidity(
  item: ItemForLiquidityCheck,
  context: LiquidityContext = {}
): {
  similar_items_sold_7d: number;
  estimated_days_to_sell: number;
  demand_strength: "high" | "medium" | "low";
} {
  const similarItemsSold = context.similar_items_sold_7d ?? 0;
  let demandStrength: "high" | "medium" | "low" = "medium";

  if (item.listing_type === "full_pc") {
    demandStrength = "high";
  } else if (item.components.some((component) => component.component_type === "gpu")) {
    demandStrength = "high";
  } else if (item.listing_type === "part") {
    demandStrength = item.components.some((component) => ["cpu", "ram", "ssd"].includes(component.component_type))
      ? "medium"
      : "low";
  } else {
    demandStrength = "low";
  }

  let estimatedDaysToSell = demandStrength === "high" ? 5 : demandStrength === "medium" ? 10 : 21;
  const priceValue = item.price_value ?? 0;

  if (priceValue > 1500000) {
    estimatedDaysToSell += 7;
  } else if (priceValue > 500000) {
    estimatedDaysToSell += 3;
  }

  return {
    similar_items_sold_7d: similarItemsSold,
    estimated_days_to_sell: estimatedDaysToSell,
    demand_strength: demandStrength
  };
}
