export type ManualPriceSeedScope = "part" | "full_pc";
export type ManualPriceSeedSource = "manual_seed";

export interface ManualPriceSeedEntry {
  listing_scope: ManualPriceSeedScope;
  component_type: string;
  canonical_name: string;
  fair_price: number;
  average_price_7d: number;
  average_price_30d: number;
  quick_trade_price: number;
}

export interface ManualPriceSeedWindow {
  component_key: string;
  component_type: string;
  listing_scope: ManualPriceSeedScope;
  window_days: number;
  average_price: number | null;
  sample_count: number;
  trade_estimate: number | null;
  source: ManualPriceSeedSource;
}

export interface ManualPriceSeedSummary {
  as_of: string;
  entry_count: number;
}

export interface ManualPriceSeedHistoryPoint extends ManualPriceSeedWindow {
  run_id: string;
  date_key: string;
  date_label: string;
}

export interface ManualPriceSeedDataset {
  windows: ManualPriceSeedWindow[];
  history_points: ManualPriceSeedHistoryPoint[];
  virtual_days: number;
}

function entry(
  listingScope: ManualPriceSeedScope,
  componentType: string,
  canonicalName: string,
  fairPrice: number,
  averagePrice7d: number,
  averagePrice30d: number,
  quickTradePrice: number
): ManualPriceSeedEntry {
  return {
    listing_scope: listingScope,
    component_type: componentType,
    canonical_name: canonicalName,
    fair_price: fairPrice,
    average_price_7d: averagePrice7d,
    average_price_30d: averagePrice30d,
    quick_trade_price: quickTradePrice
  };
}

export const MANUAL_PRICE_SEED_AS_OF = "2026-04-25";
export const MANUAL_PRICE_SEED_VIRTUAL_DAYS = 30;
const MANUAL_PRICE_SEED_WINDOW_DAYS = [7, 30, 60, 90] as const;

export const MANUAL_PRICE_SEED: ManualPriceSeedEntry[] = [
  entry("part", "gpu", "NVIDIA GTX 1060", 90000, 90000, 90000, 80000),
  entry("part", "gpu", "NVIDIA GTX 1660 SUPER", 135000, 135000, 135000, 120000),
  entry("part", "gpu", "NVIDIA RTX 2060", 190000, 190000, 190000, 170000),
  entry("part", "gpu", "NVIDIA RTX 3060", 300000, 300000, 300000, 280000),
  entry("part", "gpu", "NVIDIA RTX 3060 Ti", 320000, 320000, 320000, 290000),
  entry("part", "gpu", "NVIDIA RTX 3070", 340000, 340000, 340000, 310000),
  entry("part", "gpu", "NVIDIA RTX 3080", 480000, 480000, 480000, 440000),
  entry("part", "gpu", "NVIDIA RTX 4080", 980000, 980000, 980000, 930000),
  entry("part", "gpu", "NVIDIA RTX 4090", 2150000, 2150000, 2150000, 2050000),
  entry("part", "gpu", "NVIDIA RTX 4060", 370000, 370000, 370000, 340000),
  entry("part", "gpu", "NVIDIA RTX 5050", 330000, 330000, 330000, 300000),
  entry("part", "gpu", "NVIDIA RTX 5060 Ti", 560000, 560000, 560000, 530000),
  entry("part", "gpu", "NVIDIA RTX 5070", 1320000, 1320000, 1320000, 1250000),
  entry("part", "gpu", "NVIDIA RTX 5090", 3450000, 3450000, 3450000, 3320000),
  entry("part", "gpu", "AMD Radeon RX 6600", 230000, 230000, 230000, 210000),
  entry("part", "gpu", "AMD Radeon RX 6700 XT", 290000, 290000, 290000, 260000),
  entry("part", "gpu", "AMD Radeon RX 7700 XT", 520000, 520000, 520000, 480000),
  entry("part", "gpu", "AMD Radeon RX 9060", 485000, 485000, 485000, 460000),
  entry("part", "gpu", "AMD Radeon RX 9070", 860000, 860000, 860000, 820000),
  entry("part", "cpu", "AMD Ryzen 5 3600", 75000, 75000, 75000, 65000),
  entry("part", "cpu", "AMD Ryzen 3 4350G", 100000, 100000, 100000, 90000),
  entry("part", "cpu", "AMD Ryzen 5 5600", 130000, 130000, 130000, 115000),
  entry("part", "cpu", "AMD Ryzen 5 5600X", 150000, 150000, 150000, 135000),
  entry("part", "cpu", "AMD Ryzen 7 5700X", 190000, 190000, 190000, 170000),
  entry("part", "cpu", "AMD Ryzen 7 5800X", 220000, 220000, 220000, 200000),
  entry("part", "cpu", "AMD Ryzen 7 3800X", 125000, 125000, 125000, 110000),
  entry("part", "cpu", "AMD Ryzen 5 7400F", 190000, 190000, 190000, 180000),
  entry("part", "cpu", "AMD Ryzen 5 7500F", 135000, 135000, 135000, 120000),
  entry("part", "cpu", "AMD Ryzen 5 8600G", 190000, 190000, 190000, 180000),
  entry("part", "cpu", "AMD Ryzen 5 9500F", 360000, 360000, 360000, 340000),
  entry("part", "cpu", "AMD Ryzen 5 9600X", 225000, 225000, 225000, 210000),
  entry("part", "cpu", "AMD Ryzen 7 7800X3D", 380000, 380000, 380000, 360000),
  entry("part", "cpu", "AMD Ryzen 7 9700X", 320000, 320000, 320000, 300000),
  entry("part", "cpu", "AMD Ryzen 7 9800X3D", 486000, 486000, 486000, 460000),
  entry("part", "cpu", "AMD Ryzen 9 7950X", 420000, 420000, 420000, 390000),
  entry("part", "cpu", "Intel Core i5-10400F", 120000, 120000, 120000, 105000),
  entry("part", "cpu", "Intel Core i5-6500", 50000, 50000, 50000, 40000),
  entry("part", "cpu", "Intel Core i5-7500", 70000, 70000, 70000, 60000),
  entry("part", "cpu", "Intel Core i3-7100", 35000, 35000, 35000, 30000),
  entry("part", "cpu", "Intel Core i3-8100", 55000, 55000, 55000, 45000),
  entry("part", "cpu", "Intel Core i7-6700", 85000, 85000, 85000, 75000),
  entry("part", "cpu", "Intel Core i7-7700", 110000, 110000, 110000, 95000),
  entry("part", "cpu", "Intel Core i3-12100", 105000, 105000, 105000, 95000),
  entry("part", "cpu", "Intel Core i3-12100F", 110000, 110000, 110000, 100000),
  entry("part", "cpu", "Intel Core i5-12400F", 165000, 165000, 165000, 145000),
  entry("part", "cpu", "Intel Core i5-13400F", 190000, 190000, 190000, 170000),
  entry("part", "cpu", "Intel Core i5-13600K", 260000, 260000, 260000, 240000),
  entry("part", "cpu", "Intel Core i5-9400F", 110000, 110000, 110000, 95000),
  entry("part", "cpu", "Intel Core i5-9500F", 125000, 125000, 125000, 110000),
  entry("part", "cpu", "Intel Core i7-12700F", 280000, 280000, 280000, 250000),
  entry("part", "cpu", "Intel Core i7-13700KF", 360000, 360000, 360000, 330000),
  entry("part", "cpu", "Intel Core i7-14700KF", 470000, 470000, 470000, 440000),
  entry("part", "cpu", "Intel Core Ultra 5", 240000, 240000, 240000, 220000),
  entry("part", "ram", "DDR4 8GB", 55000, 55000, 55000, 45000),
  entry("part", "ram", "DDR4 16GB", 100000, 100000, 100000, 85000),
  entry("part", "ram", "DDR4 32GB", 200000, 200000, 200000, 170000),
  entry("part", "ram", "DDR4 64GB", 340000, 340000, 340000, 300000),
  entry("part", "ram", "DDR5 16GB", 180000, 180000, 180000, 160000),
  entry("part", "ram", "DDR5 32GB", 350000, 350000, 350000, 310000),
  entry("part", "ram", "DDR5 64GB", 620000, 620000, 620000, 570000),
  entry("part", "ssd", "SSD 256GB", 40000, 40000, 40000, 30000),
  entry("part", "ssd", "SSD 500GB", 80000, 80000, 80000, 65000),
  entry("part", "ssd", "SSD 1TB", 150000, 150000, 150000, 130000),
  entry("part", "ssd", "SSD 2TB", 250000, 250000, 250000, 220000),
  entry("part", "psu", "unknown PSU 500W", 10000, 10000, 10000, 8000),
  entry("part", "psu", "unknown PSU 600W", 15000, 15000, 15000, 10000),
  entry("part", "psu", "unknown PSU 700W", 25000, 25000, 25000, 20000),
  entry("part", "psu", "unknown PSU 800W", 35000, 35000, 35000, 28000),
  entry("part", "psu", "unknown PSU 850W", 45000, 45000, 45000, 38000),
  entry("part", "psu", "unknown PSU 1000W", 65000, 65000, 65000, 55000),
  entry("part", "psu", "Micronics Classic II 600W", 24000, 24000, 24000, 20000),
  entry("part", "psu", "Micronics Classic II 700W", 45000, 45000, 45000, 40000),
  entry("part", "psu", "FSP Hyper K 600W", 25000, 25000, 25000, 20000),
  entry("part", "psu", "FSP Hydro 700W", 35000, 35000, 35000, 30000),
  entry("part", "psu", "Seasonic Focus 750W", 50000, 50000, 50000, 45000),
  entry("part", "psu", "SuperFlower Leadex 750W", 50000, 50000, 50000, 40000),
  entry("part", "psu", "Corsair RM750e", 100000, 100000, 100000, 85000),
  entry("part", "motherboard", "AM4 A320 unknown", 40000, 40000, 40000, 30000),
  entry("part", "motherboard", "AM4 B450 unknown", 70000, 70000, 70000, 60000),
  entry("part", "motherboard", "AM4 B550 unknown", 80000, 80000, 80000, 70000),
  entry("part", "motherboard", "AM4 B550 ASUS", 100000, 100000, 100000, 85000),
  entry("part", "motherboard", "AM4 B550 MSI", 110000, 110000, 110000, 95000),
  entry("part", "motherboard", "LGA1151 B365 unknown", 75000, 75000, 75000, 65000),
  entry("part", "motherboard", "LGA1200 B460 unknown", 65000, 65000, 65000, 55000),
  entry("part", "motherboard", "LGA1700 H610 unknown", 60000, 60000, 60000, 50000),
  entry("part", "motherboard", "LGA1700 B660 unknown", 90000, 90000, 90000, 75000),
  entry("part", "motherboard", "LGA1700 B760 unknown", 110000, 110000, 110000, 90000),
  entry("part", "motherboard", "LGA1700 Z790 unknown", 230000, 230000, 230000, 210000),
  entry("part", "motherboard", "AM5 A620 unknown", 70000, 70000, 70000, 60000),
  entry("part", "motherboard", "AM5 B650 unknown", 110000, 110000, 110000, 95000),
  entry("part", "motherboard", "AM5 B650 ASUS", 130000, 130000, 130000, 110000),
  entry("part", "motherboard", "AM5 B650 MSI", 140000, 140000, 140000, 120000),
  entry("part", "motherboard", "AM5 X870 unknown", 250000, 250000, 250000, 230000),
  entry("full_pc", "bundle", "AMD Ryzen 5 5600 + NVIDIA RTX 3060", 800000, 800000, 800000, 720000),
  entry("full_pc", "bundle", "Intel Core i5-12400F + NVIDIA RTX 3060", 820000, 820000, 820000, 740000),
  entry("full_pc", "bundle", "AMD Ryzen 7 5700X + NVIDIA RTX 3070", 950000, 950000, 950000, 850000),
  entry("full_pc", "bundle", "AMD Ryzen 5 7500F + NVIDIA RTX 4060", 950000, 950000, 950000, 850000)
];

export function getManualPriceSeedSummary(): ManualPriceSeedSummary {
  return {
    as_of: MANUAL_PRICE_SEED_AS_OF,
    entry_count: MANUAL_PRICE_SEED.length
  };
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10));
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildSeedWindow(item: ManualPriceSeedEntry, windowDays: number): ManualPriceSeedWindow {
  return {
    component_key: item.canonical_name,
    component_type: item.component_type,
    listing_scope: item.listing_scope,
    window_days: windowDays,
    average_price: windowDays === 7 ? item.average_price_7d : item.average_price_30d,
    sample_count: Math.min(windowDays, MANUAL_PRICE_SEED_VIRTUAL_DAYS),
    trade_estimate: item.quick_trade_price,
    source: "manual_seed"
  };
}

function buildSeedHistoryPoint(item: ManualPriceSeedEntry, windowDays: number, dateKey: string): ManualPriceSeedHistoryPoint {
  const window = buildSeedWindow(item, windowDays);
  return {
    run_id: `manual-seed-${dateKey}`,
    date_key: dateKey,
    date_label: dateKey.slice(5),
    ...window
  };
}

export function buildManualPriceSeedDataset(virtualDays = MANUAL_PRICE_SEED_VIRTUAL_DAYS): ManualPriceSeedDataset {
  const asOfDate = parseDateKey(MANUAL_PRICE_SEED_AS_OF);
  const historyPoints: ManualPriceSeedHistoryPoint[] = [];

  for (let dayOffset = virtualDays - 1; dayOffset >= 0; dayOffset -= 1) {
    const currentDate = new Date(asOfDate);
    currentDate.setUTCDate(asOfDate.getUTCDate() - dayOffset);
    const dateKey = formatDateKey(currentDate);

    for (const item of MANUAL_PRICE_SEED) {
      for (const windowDays of MANUAL_PRICE_SEED_WINDOW_DAYS) {
        historyPoints.push(buildSeedHistoryPoint(item, windowDays, dateKey));
      }
    }
  }

  const latestWindows = historyPoints
    .filter((point) => point.date_key === MANUAL_PRICE_SEED_AS_OF)
    .map(({ run_id: _runId, date_key: _dateKey, date_label: _dateLabel, ...window }) => window);

  return {
    windows: latestWindows,
    history_points: historyPoints,
    virtual_days: virtualDays
  };
}
