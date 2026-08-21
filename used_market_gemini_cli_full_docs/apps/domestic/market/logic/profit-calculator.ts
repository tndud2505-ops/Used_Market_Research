import type { MergedItem, NormalizedItem } from "../../MCP/logic/types.js";

interface ProfitCalculationOptions {
  transaction_fee_rate: number;
  shipping_cost: number;
  repair_cost: number;
  resale_margin_rate: number;
}

type ItemForProfitCheck = Pick<NormalizedItem, "price_value"> & {
  baseline_price?: MergedItem["baseline_price"];
};

const DEFAULT_OPTIONS: ProfitCalculationOptions = {
  transaction_fee_rate: 0.1,
  shipping_cost: 5000,
  repair_cost: 10000,
  resale_margin_rate: 0.15
};

export function calculateProfit(
  item: ItemForProfitCheck,
  options: Partial<ProfitCalculationOptions> = {}
): {
  estimated_deal_price: number | null;
  transaction_fee: number;
  shipping_cost: number;
  repair_cost: number;
  net_profit: number | null;
  profit_margin: number | null;
} {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const dealPrice = item.price_value;
  const resaleBasePrice = item.baseline_price ?? item.price_value ?? 0;
  const estimatedResalePrice = Math.round(resaleBasePrice * (1 + opts.resale_margin_rate));

  if (!dealPrice || dealPrice <= 0) {
    return {
      estimated_deal_price: null,
      transaction_fee: 0,
      shipping_cost: opts.shipping_cost,
      repair_cost: opts.repair_cost,
      net_profit: null,
      profit_margin: null
    };
  }

  const transactionFee = Math.round(dealPrice * opts.transaction_fee_rate);
  const totalCost = dealPrice + transactionFee + opts.shipping_cost + opts.repair_cost;
  const netProfit = estimatedResalePrice - totalCost;
  const profitMargin = Math.round((netProfit / dealPrice) * 100);

  return {
    estimated_deal_price: dealPrice,
    transaction_fee: transactionFee,
    shipping_cost: opts.shipping_cost,
    repair_cost: opts.repair_cost,
    net_profit: netProfit,
    profit_margin: profitMargin
  };
}
