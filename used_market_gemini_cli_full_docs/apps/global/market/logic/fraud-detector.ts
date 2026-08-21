import type { MergedItem, NormalizedItem } from "../../MCP/logic/types.js";

interface FraudCheckOptions {
  baseline_price: number | null;
  price_threshold_ratio: number;
}

type ItemForFraudCheck = Pick<NormalizedItem, "price_value" | "raw_notes" | "seller_name" | "location"> & {
  baseline_price?: MergedItem["baseline_price"];
};

export function detectFraud(
  item: ItemForFraudCheck,
  options: FraudCheckOptions = { baseline_price: null, price_threshold_ratio: 1.2 }
): {
  fraud_risk_score: number;
  fraud_flags: string[];
} {
  const fraudFlags: string[] = [];
  let riskScore = 0;

  const itemPrice = item.price_value ?? 0;

  if (options.baseline_price && options.baseline_price > 0) {
    const priceFactor = itemPrice / options.baseline_price;
    if (priceFactor > options.price_threshold_ratio) {
      fraudFlags.push(`Price ${Math.round(priceFactor * 100)}% above baseline - possible markup fraud`);
      riskScore += 0.4;
    }
  }

  const descriptionLength = item.raw_notes?.length ?? 0;
  if (descriptionLength < 20) {
    fraudFlags.push(`Description too short (${descriptionLength} chars) - low quality indicator`);
    riskScore += 0.2;
  }

  if (item.price_value === null || item.price_value === 0) {
    fraudFlags.push("Price not specified - suspicious");
    riskScore += 0.3;
  }

  if (!item.seller_name || item.seller_name.trim().length < 2) {
    fraudFlags.push("Seller information missing or incomplete");
    riskScore += 0.15;
  }

  if (!item.location || item.location.trim().length < 2) {
    fraudFlags.push("Location information missing");
    riskScore += 0.1;
  }

  const finalScore = Math.min(1, riskScore);

  return {
    fraud_risk_score: Math.round(finalScore * 100) / 100,
    fraud_flags: fraudFlags
  };
}
