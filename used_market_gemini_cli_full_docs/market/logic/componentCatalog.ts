export type ComponentPatternEntry = {
  componentType: "gpu" | "cpu" | "ram" | "ssd" | "psu" | "motherboard";
  canonical: string;
  patterns: RegExp[];
};

export type ListingTitleHintEntry = {
  listingType: "full_pc" | "semi_pc" | "part";
  patterns: RegExp[];
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loosePattern(alias: string) {
  return new RegExp(
    escapeRegExp(alias)
      .replace(/\\\+/g, "\\s*\\+\\s*")
      .replace(/\\\-/g, "[-\\s]*")
      .replace(/\s+/g, "[\\s:]*"),
    "i"
  );
}

function tokenPattern(alias: string) {
  const source = escapeRegExp(alias)
    .replace(/\\\+/g, "\\s*\\+\\s*")
    .replace(/\\\-/g, "[-\\s]*")
    .replace(/\s+/g, "[\\s:]*");
  return new RegExp(`(?<![A-Za-z0-9])${source}(?![A-Za-z0-9])`, "i");
}

function aliasPattern(alias: string) {
  return /\d/.test(alias) ? tokenPattern(alias) : loosePattern(alias);
}

function wordPattern(alias: string) {
  return new RegExp(`\\b${escapeRegExp(alias).replace(/\s+/g, "\\s*")}\\b`, "i");
}

function buildPatterns(...aliases: string[]) {
  return aliases.map((alias) => aliasPattern(alias));
}

function gpuEntry(canonical: string, ...aliases: string[]): ComponentPatternEntry {
  const compact = canonical.replace(/^NVIDIA\s+/i, "").replace(/^AMD\s+Radeon\s+/i, "");
  return {
    componentType: "gpu",
    canonical,
    patterns: [
      aliasPattern(compact),
      ...buildPatterns(...aliases)
    ]
  };
}

function cpuEntry(canonical: string, ...aliases: string[]): ComponentPatternEntry {
  const compact = canonical
    .replace(/^AMD\s+/i, "")
    .replace(/^Intel\s+/i, "")
    .replace(/^Ryzen\s+/i, "Ryzen ")
    .replace(/^Core\s+/i, "Core ");
  return {
    componentType: "cpu",
    canonical,
    patterns: [
      aliasPattern(compact),
      ...buildPatterns(...aliases)
    ]
  };
}

function bucketEntry(
  componentType: ComponentPatternEntry["componentType"],
  canonical: string,
  ...aliases: string[]
): ComponentPatternEntry {
  return {
    componentType,
    canonical,
    patterns: buildPatterns(canonical, ...aliases)
  };
}

export const COMPONENT_PATTERNS: ComponentPatternEntry[] = [
  gpuEntry("NVIDIA GTX 1050", "GTX1050", "1050 Ti", "GTX 1050 Ti", "GeForce 1050", "GeForce GTX 1050"),
  gpuEntry("NVIDIA GTX 1060", "GTX1060", "GeForce 1060", "GeForce GTX 1060"),
  gpuEntry("NVIDIA GTX 1070", "GTX1070", "GeForce 1070", "GeForce GTX 1070"),
  gpuEntry("NVIDIA GTX 1070 Ti", "GTX1070TI", "1070 Ti", "GeForce 1070 Ti", "GeForce GTX 1070 Ti"),
  gpuEntry("NVIDIA GTX 1080", "GTX1080", "GeForce 1080", "GeForce GTX 1080"),
  gpuEntry("NVIDIA GTX 1080 Ti", "GTX1080TI", "1080 Ti", "GeForce 1080 Ti", "GeForce GTX 1080 Ti"),
  gpuEntry("NVIDIA GTX 1660", "GTX1660", "GeForce GTX 1660"),
  gpuEntry("NVIDIA GTX 1660 SUPER", "GTX1660SUPER", "1660 Super", "GeForce GTX 1660 SUPER"),
  gpuEntry("NVIDIA RTX 2060", "RTX2060", "GeForce RTX 2060"),
  gpuEntry("NVIDIA RTX 2060 SUPER", "RTX2060SUPER", "2060 Super", "GeForce RTX 2060 SUPER"),
  gpuEntry("NVIDIA RTX 2070", "RTX2070", "GeForce RTX 2070"),
  gpuEntry("NVIDIA RTX 2070 SUPER", "RTX2070SUPER", "2070 Super", "GeForce RTX 2070 SUPER"),
  gpuEntry("NVIDIA RTX 3060", "RTX3060", "3060", "GeForce RTX 3060", "\uC9C0\uD3EC\uC2A4 RTX 3060"),
  gpuEntry("NVIDIA RTX 3060 Ti", "RTX3060TI", "3060 Ti", "GeForce RTX 3060 Ti", "\uC9C0\uD3EC\uC2A4 RTX 3060 Ti"),
  gpuEntry("NVIDIA RTX 3070", "RTX3070", "GeForce RTX 3070"),
  gpuEntry("NVIDIA RTX 3070 Ti", "RTX3070TI", "3070 Ti", "GeForce RTX 3070 Ti"),
  gpuEntry("NVIDIA RTX 3080", "RTX3080", "GeForce RTX 3080"),
  gpuEntry("NVIDIA RTX 4080", "RTX4080", "GeForce RTX 4080", "RTX4080SUPER", "RTX 4080 SUPER", "GeForce RTX 4080 SUPER"),
  gpuEntry("NVIDIA RTX 4090", "RTX4090", "GeForce RTX 4090"),
  gpuEntry("NVIDIA RTX 4060", "RTX4060", "4060", "GeForce RTX 4060"),
  gpuEntry("NVIDIA RTX 4060 Ti", "RTX4060TI", "4060 Ti", "4060Ti", "GeForce RTX 4060 Ti"),
  gpuEntry("NVIDIA RTX 5050", "RTX5050", "GeForce RTX 5050"),
  gpuEntry("NVIDIA RTX 5060 Ti", "RTX5060TI", "5060 Ti", "GeForce RTX 5060 Ti"),
  gpuEntry("NVIDIA RTX 5070", "RTX5070", "5070", "GeForce RTX 5070"),
  gpuEntry("NVIDIA RTX 5070 Ti", "RTX5070TI", "5070 Ti", "5070Ti", "GeForce RTX 5070 Ti"),
  gpuEntry("NVIDIA RTX 5080", "RTX5080", "5080", "GeForce RTX 5080"),
  gpuEntry("NVIDIA RTX 5090", "RTX5090", "GeForce RTX 5090", "지포스 RTX 5090"),
  gpuEntry("AMD Radeon RX 6600", "RX6600", "Radeon 6600"),
  gpuEntry("AMD Radeon RX 6600 XT", "RX6600XT", "6600 XT", "Radeon 6600 XT"),
  gpuEntry("AMD Radeon RX 6700 XT", "RX6700XT", "6700 XT", "Radeon 6700 XT"),
  gpuEntry("AMD Radeon RX 7700 XT", "RX7700XT", "RX 7700 XT", "7700 XT", "Radeon RX 7700 XT"),
  gpuEntry("AMD Radeon RX 9060", "RX9060", "Radeon 9060"),
  gpuEntry("AMD Radeon RX 9070", "RX9070", "Radeon 9070", "Radeon RX 9070"),
  gpuEntry("AMD Radeon RX 9070 XT", "RX9070XT", "9070 XT", "Radeon 9070 XT", "Radeon RX 9070 XT"),
  gpuEntry("AMD Radeon RX 7600", "RX7600", "Radeon 7600"),

  cpuEntry("AMD Ryzen 5 3600", "Ryzen 5 3600", "Ryzen 3600", "3600", "\uB77C\uC774\uC820 5 3600", "\uB77C\uC774\uC820 3600"),
  cpuEntry("AMD Ryzen 5 5500", "Ryzen 5 5500", "Ryzen 5500", "5500", "\uB77C\uC774\uC820 5 5500", "\uB77C\uC774\uC820 5500"),
  cpuEntry("AMD Ryzen 5 5600", "Ryzen 5 5600", "Ryzen 5600", "5600", "\uB77C\uC774\uC820 5 5600", "\uB77C\uC774\uC8205600", "\uB77C\uC774\uC820 5600"),
  cpuEntry("AMD Ryzen 5 5600X", "Ryzen 5 5600X", "Ryzen 5600X", "5600X", "\uB77C\uC774\uC820 5 5600X", "\uB77C\uC774\uC820 5600X"),
  cpuEntry("AMD Ryzen 5 5600G", "Ryzen 5 5600G", "Ryzen 5600G", "5600G", "\uB77C\uC774\uC820 5 5600G", "\uB77C\uC774\uC820 5600G"),
  cpuEntry("AMD Ryzen 7 5700X", "Ryzen 7 5700X", "Ryzen 5700X", "5700X", "\uB77C\uC774\uC820 7 5700X", "\uB77C\uC774\uC820 5700X"),
  cpuEntry("AMD Ryzen 7 5800X", "Ryzen 7 5800X", "Ryzen 5800X", "5800X", "\uB77C\uC774\uC820 7 5800X", "\uB77C\uC774\uC820 5800X"),
  cpuEntry("AMD Ryzen 7 3800X", "Ryzen 7 3800X", "Ryzen 3800X", "3800X", "\uB77C\uC774\uC820 7 3800X", "\uB77C\uC774\uC820 3800X"),
  cpuEntry("AMD Ryzen 5 7500F", "Ryzen 5 7500F", "Ryzen 7500F", "7500F", "\uB77C\uC774\uC820 5 7500F", "\uB77C\uC774\uC820 7500F"),
  cpuEntry("AMD Ryzen 5 7400F", "Ryzen 5 7400F", "Ryzen 7400F", "\uB77C\uC774\uC820 5 7400F", "\uB77C\uC774\uC820 7400F"),
  cpuEntry("AMD Ryzen 5 8600G", "Ryzen 5 8600G", "Ryzen 8600G", "\uB77C\uC774\uC820 5 8600G", "\uB77C\uC774\uC820 8600G"),
  cpuEntry("AMD Ryzen 5 9500F", "Ryzen 5 9500F", "Ryzen 9500F", "\uB77C\uC774\uC820 5 9500F", "\uB77C\uC774\uC820 9500F"),
  cpuEntry("AMD Ryzen 5 9600X", "Ryzen 5 9600X", "Ryzen 9600X", "\uB77C\uC774\uC820 5 9600X", "\uB77C\uC774\uC820 9600X"),
  cpuEntry("AMD Ryzen 7 7800X3D", "Ryzen 7 7800X3D", "Ryzen 7800X3D", "7800X3D", "\uB77C\uC774\uC820 7 7800X3D", "\uB77C\uC774\uC820 7800X3D"),
  cpuEntry("AMD Ryzen 7 9700X", "Ryzen 7 9700X", "Ryzen 9700X", "\uB77C\uC774\uC820 7 9700X", "\uB77C\uC774\uC820 9700X"),
  cpuEntry("AMD Ryzen 7 9800X3D", "Ryzen 7 9800X3D", "Ryzen 9800X3D", "9800X3D", "\uB77C\uC774\uC820 7 9800X3D", "\uB77C\uC774\uC820 9800X3D"),
  cpuEntry("AMD Ryzen 9 7950X", "Ryzen 9 7950X", "Ryzen 7950X", "7950X", "\uB77C\uC774\uC820 9 7950X", "\uB77C\uC774\uC820 7950X"),
  cpuEntry("AMD Ryzen 9 7950X3D", "Ryzen 9 7950X3D", "Ryzen 7950X3D", "\uB77C\uC774\uC820 9 7950X3D", "\uB77C\uC774\uC820 7950X3D"),
  cpuEntry("AMD Ryzen 3 4350G", "Ryzen 3 4350G", "Ryzen 4350G", "Ryzen 3 PRO 4350G", "PRO 4350G", "\uB77C\uC774\uC820 3 4350G", "\uB77C\uC774\uC820 4350G"),
  cpuEntry("Intel Core i5-6500", "i5 6500", "i5-6500", "\uCF54\uC5B4 i5 6500"),
  cpuEntry("Intel Core i5-7500", "i5 7500", "i5-7500", "\uCF54\uC5B4 i5 7500"),
  cpuEntry("Intel Core i3-7100", "i3 7100", "i3-7100", "\uCF54\uC5B4 i3 7100"),
  cpuEntry("Intel Core i3-8100", "i3 8100", "i3-8100", "\uCF54\uC5B4 i3 8100"),
  cpuEntry("Intel Core i7-6700", "i7 6700", "i7-6700", "\uCF54\uC5B4 i7 6700"),
  cpuEntry("Intel Core i7-7700", "i7 7700", "i7-7700", "\uCF54\uC5B4 i7 7700"),
  cpuEntry("Intel Core i5-10400F", "i5 10400F", "i5-10400F", "10400F", "\uCF54\uC5B4 i5 10400F"),
  cpuEntry("Intel Core i5-11400F", "i5 11400F", "i5-11400F", "11400F", "\uCF54\uC5B4 i5 11400F"),
  cpuEntry("Intel Core i3-12100", "i3 12100", "i3-12100", "\uCF54\uC5B4 i3 12100"),
  cpuEntry("Intel Core i3-12100F", "i3 12100F", "i3-12100F", "\uCF54\uC5B4 i3 12100F"),
  cpuEntry("Intel Core i5-12400F", "i5 12400F", "i5-12400F", "12400F", "\uCF54\uC5B4 i5 12400F"),
  cpuEntry("Intel Core i5-13400F", "i5 13400F", "i5-13400F", "13400F", "\uCF54\uC5B4 i5 13400F"),
  cpuEntry("Intel Core i5-13600K", "i5 13600K", "i5-13600K", "13600K", "\uCF54\uC5B4 i5 13600K"),
  cpuEntry("Intel Core i5-9400F", "i5 9400F", "i5-9400F", "\uCF54\uC5B4 i5 9400F"),
  cpuEntry("Intel Core i5-9500F", "i5 9500F", "i5-9500F", "\uCF54\uC5B4 i5 9500F"),
  cpuEntry("Intel Core i7-12700F", "i7 12700F", "i7-12700F", "12700F", "\uCF54\uC5B4 i7 12700F"),
  cpuEntry("Intel Core i7-12700K", "i7 12700K", "i7-12700K", "12700K", "\uCF54\uC5B4 i7 12700K"),
  cpuEntry("Intel Core i7-13700KF", "i7 13700KF", "i7-13700KF", "13700KF", "\uCF54\uC5B4 i7 13700KF", "\uC778\uD154 13700KF"),
  cpuEntry("Intel Core i7-14700KF", "i7 14700KF", "i7-14700KF", "14700KF", "\uCF54\uC5B4 i7 14700KF"),
  cpuEntry("Intel Core i7-9700F", "i7 9700F", "i7-9700F", "\uCF54\uC5B4 i7 9700F"),
  cpuEntry("Intel Core i9-9900K", "i9 9900K", "i9-9900K", "\uCF54\uC5B4 i9 9900K"),
  cpuEntry("Intel Core i9-10900K", "i9 10900K", "i9-10900K", "\uCF54\uC5B4 i9 10900K"),
  cpuEntry("Intel Core Ultra 5", "Ultra 5", "Core Ultra 5", "\uCF54\uC5B4 Ultra 5"),

  bucketEntry("ram", "DDR4 8GB", "RAM 8GB", "RAM 8G", "8GB", "8G", "DDR4 8G", "8GBx1", "\uB7A8 8GB", "\uB7A8 8G", "\uBA54\uBAA8\uB9AC 8GB"),
  bucketEntry("ram", "DDR4 16GB", "RAM 16GB", "RAM 16G", "16GB", "16G", "DDR4 16G", "2x8GB", "8GBx2", "\uB7A8 16GB", "\uB7A8 16G", "\uBA54\uBAA8\uB9AC 16GB", "\uC0BC\uC131\uB7A8 16GB"),
  bucketEntry("ram", "DDR4 32GB", "RAM 32GB", "RAM 32G", "32GB", "32G", "DDR4 32G", "2x16GB", "16GBx2", "\uB7A8 32GB", "\uB7A8 32G", "\uBA54\uBAA8\uB9AC 32GB"),
  bucketEntry("ram", "DDR4 64GB", "RAM 64GB", "RAM 64G", "64GB", "64G", "DDR4 64G", "2x32GB", "32GBx2", "\uB7A8 64GB", "\uB7A8 64G", "\uBA54\uBAA8\uB9AC 64GB"),
  bucketEntry("ram", "DDR5 16GB", "DDR5 16G", "DDR5 16 GB", "DDR5-16GB", "DDR5 8GBx2"),
  bucketEntry("ram", "DDR5 32GB", "DDR5 32G", "DDR5 32 GB", "DDR5-32GB", "DDR5 16GBx2", "DDR5 16Gx2"),
  bucketEntry("ram", "DDR5 64GB", "DDR5 64G", "DDR5 64 GB", "DDR5-64GB", "DDR5 32GBx2", "DDR5 32Gx2", "64GB(32Gx2)", "64GB (32Gx2)"),

  bucketEntry("ssd", "Samsung PM991a 256GB", "PM991A 256GB", "Samsung PM991a 256GB", "Samsung PM991a SSD 256GB", "\uC0BC\uC131 PM991a 256GB"),
  bucketEntry("ssd", "Samsung PM991a 512GB", "PM991A 512GB", "Samsung PM991a 512GB", "Samsung PM991a SSD 512GB", "\uC0BC\uC131 PM991a 512GB"),
  bucketEntry("ssd", "Samsung 860 EVO 500GB", "860 EVO 500GB", "860 EVO SSD 500GB", "Samsung 860 EVO 500GB", "Samsung 860 EVO SSD 500GB", "\uC0BC\uC131 860 EVO 500GB", "\uC0BC\uC131 860 EVO SSD 500GB"),
  bucketEntry("ssd", "Samsung 860 EVO 1TB", "860 EVO 1TB", "860 EVO SSD 1TB", "Samsung 860 EVO 1TB", "Samsung 860 EVO SSD 1TB", "\uC0BC\uC131 860 EVO 1TB", "\uC0BC\uC131 860 EVO SSD 1TB"),
  bucketEntry("ssd", "Samsung 860 EVO 2TB", "860 EVO 2TB", "860 EVO SSD 2TB", "Samsung 860 EVO 2TB", "Samsung 860 EVO SSD 2TB", "\uC0BC\uC131 860 EVO 2TB", "\uC0BC\uC131 860 EVO SSD 2TB"),
  bucketEntry("ssd", "Samsung 870 EVO 500GB", "870 EVO 500GB", "870 EVO SSD 500GB", "Samsung 870 EVO 500GB", "Samsung 870 EVO SSD 500GB", "\uC0BC\uC131 870 EVO 500GB", "\uC0BC\uC131 870 EVO SSD 500GB"),
  bucketEntry("ssd", "Samsung 870 EVO 1TB", "870 EVO 1TB", "870 EVO SSD 1TB", "Samsung 870 EVO 1TB", "Samsung 870 EVO SSD 1TB", "\uC0BC\uC131 870 EVO 1TB", "\uC0BC\uC131 870 EVO SSD 1TB"),
  bucketEntry("ssd", "Samsung 870 EVO 2TB", "870 EVO 2TB", "870 EVO SSD 2TB", "Samsung 870 EVO 2TB", "Samsung 870 EVO SSD 2TB", "\uC0BC\uC131 870 EVO 2TB", "\uC0BC\uC131 870 EVO SSD 2TB"),
  bucketEntry("ssd", "Samsung PM9A1 1TB", "PM9A1 1TB", "PM9A1 SSD 1TB", "Samsung PM9A1 1TB", "Samsung PM9A1 SSD 1TB", "\uC0BC\uC131 PM9A1 1TB", "\uC0BC\uC131 PM9A1 SSD 1TB"),
  bucketEntry("ssd", "Samsung PM9A1 2TB", "PM9A1 2TB", "PM9A1 SSD 2TB", "Samsung PM9A1 2TB", "Samsung PM9A1 SSD 2TB", "\uC0BC\uC131 PM9A1 2TB", "\uC0BC\uC131 PM9A1 SSD 2TB"),
  bucketEntry("ssd", "Crucial MX500 500GB", "MX500 500GB", "MX500 SSD 500GB", "Crucial MX500 500GB", "Crucial MX500 SSD 500GB"),
  bucketEntry("ssd", "Crucial MX500 1TB", "MX500 1TB", "MX500 SSD 1TB", "Crucial MX500 1TB", "Crucial MX500 SSD 1TB"),
  bucketEntry("ssd", "Crucial P5 1TB", "P5 1TB", "P5 NVMe 1TB", "P5 SSD 1TB", "Crucial P5 1TB", "Crucial P5 M.2 NVMe 1TB"),
  bucketEntry("ssd", "Crucial P5 2TB", "P5 2TB", "P5 NVMe 2TB", "P5 SSD 2TB", "Crucial P5 2TB", "Crucial P5 M.2 NVMe 2TB"),
  bucketEntry("ssd", "Crucial P5 Plus 1TB", "P5 Plus 1TB", "P5 Plus NVMe 1TB", "Crucial P5 Plus 1TB", "Crucial P5 Plus M.2 NVMe 1TB"),
  bucketEntry("ssd", "WD Blue 500GB", "WD Blue SSD 500GB"),
  bucketEntry("ssd", "WD Blue 1TB", "WD Blue SSD 1TB"),
  bucketEntry("ssd", "WD Blue SN550 500GB", "SN550 500GB", "SN550 SSD 500GB", "SN550 NVMe 500GB", "WD SN550 500GB", "WD SN550 SSD 500GB", "WD Blue SN550 500GB"),
  bucketEntry("ssd", "WD Blue SN550 1TB", "SN550 1TB", "SN550 SSD 1TB", "SN550 NVMe 1TB", "WD SN550 1TB", "WD SN550 SSD 1TB", "WD SN550 NVMe 1TB", "WD Blue SN550 1TB"),
  bucketEntry("ssd", "WD Black SN750 500GB", "SN750 500GB", "SN750 SSD 500GB", "WD SN750 500GB", "WD Black SN750 500GB"),
  bucketEntry("ssd", "WD Black SN750 1TB", "SN750 1TB", "SN750 SSD 1TB", "WD SN750 1TB", "WD SN750 SSD 1TB", "WD Black SN750 1TB"),
  bucketEntry("ssd", "WD Black SN850X 1TB", "SN850X 1TB", "SN850X SSD 1TB", "WD SN850X 1TB", "WD Black SN850X 1TB"),
  bucketEntry("ssd", "WD Black SN850X 2TB", "SN850X 2TB", "SN850X SSD 2TB", "WD SN850X 2TB", "WD Black SN850X 2TB"),
  bucketEntry("ssd", "SK hynix P31 1TB", "P31 1TB", "P31 SSD 1TB", "Gold P31 1TB", "Gold P31 SSD 1TB", "SK hynix P31 1TB"),
  bucketEntry("ssd", "SK hynix P41 1TB", "P41 1TB", "P41 SSD 1TB", "P41 M.2 NVMe SSD 1TB", "Platinum P41 1TB", "Platinum P41 SSD 1TB", "Platinum P41 M.2 NVMe SSD 1TB", "SK hynix P41 1TB", "SK hynix Platinum P41 1TB"),
  bucketEntry("ssd", "SK hynix P41 2TB", "P41 2TB", "P41 SSD 2TB", "P41 M.2 NVMe SSD 2TB", "Platinum P41 2TB", "Platinum P41 SSD 2TB", "Platinum P41 M.2 NVMe SSD 2TB", "SK hynix P41 2TB", "SK hynix Platinum P41 2TB"),
  bucketEntry("ssd", "SSD 256GB", "256GB SSD", "256G SSD", "250GB SSD", "240GB SSD", "NVMe 256GB", "M.2 256GB", "SSD 256G", "SSD 250GB", "SSD 240GB", "\uC2A4\uC2A4\uB514 256GB"),
  bucketEntry("ssd", "SSD 500GB", "500GB SSD", "500G SSD", "512GB SSD", "NVMe 500GB", "M.2 500GB", "SSD 500G", "500GB NVMe", "\uC2A4\uC2A4\uB514 500GB"),
  bucketEntry("ssd", "SSD 1TB", "1TB SSD", "1T SSD", "1000GB SSD", "NVMe 1TB", "M.2 1TB", "SSD 1T", "1TB NVMe", "\uC2A4\uC2A4\uB514 1TB"),
  bucketEntry("ssd", "SSD 2TB", "2TB SSD", "2T SSD", "2000GB SSD", "NVMe 2TB", "M.2 2TB", "SSD 2T", "\uC2A4\uC2A4\uB514 2TB"),

  bucketEntry("psu", "unknown PSU 500W", "500W PSU", "500W power", "500w 파워"),
  bucketEntry("psu", "unknown PSU 600W", "600W PSU", "600W power", "600w 파워"),
  bucketEntry("psu", "unknown PSU 700W", "700W PSU", "700W power", "700w 파워"),
  bucketEntry("psu", "unknown PSU 800W", "800W PSU", "800W power", "800w 파워"),
  bucketEntry("psu", "unknown PSU 850W", "850W PSU", "850W power", "850w power"),
  bucketEntry("psu", "unknown PSU 1000W", "1000W PSU", "1000W power", "1000w power", "FSP HYDRO G PRO 1000W", "Hydro G Pro 1000W"),
  bucketEntry("psu", "Micronics Classic II 600W", "Classic II 600W", "Micronics 600W"),
  bucketEntry("psu", "Micronics Classic II 700W", "Classic II 700W", "Micronics 700W"),
  bucketEntry("psu", "FSP Hyper K 600W", "Hyper K 600W"),
  bucketEntry("psu", "FSP Hydro 700W", "Hydro 700W"),
  bucketEntry("psu", "Seasonic Focus 750W", "Focus 750W"),
  bucketEntry("psu", "SuperFlower Leadex 750W", "Leadex 750W"),
  bucketEntry("psu", "Corsair RM750e", "RM750e", "Corsair 750W"),
  bucketEntry("psu", "unknown PSU 500W", "\uD30C\uC6CC 500W", "500W \uD30C\uC6CC"),
  bucketEntry("psu", "unknown PSU 600W", "\uD30C\uC6CC 600W", "600W \uD30C\uC6CC", "\uC288\uD37C\uD50C\uB77C\uC6CC 600W"),
  bucketEntry("psu", "unknown PSU 700W", "\uD30C\uC6CC 700W", "700W \uD30C\uC6CC"),
  bucketEntry("psu", "unknown PSU 800W", "\uD30C\uC6CC 800W", "800W \uD30C\uC6CC"),
  bucketEntry("psu", "unknown PSU 850W", "\uD30C\uC6CC 850W", "850W \uD30C\uC6CC", "\uC2DC\uC18C\uB2C9 850W"),
  bucketEntry("psu", "unknown PSU 1000W", "\uD30C\uC6CC 1000W", "1000W \uD30C\uC6CC", "FSP 1000W", "\uD558\uC774\uB4DC\uB85C G PRO 1000W"),
  bucketEntry("psu", "Micronics Classic II 600W", "\uB9C8\uC774\uD06C\uB85C\uB2C9\uC2A4 600W"),
  bucketEntry("psu", "Micronics Classic II 700W", "\uB9C8\uC774\uD06C\uB85C\uB2C9\uC2A4 700W"),

  bucketEntry("motherboard", "AM4 A320 unknown", "A320", "AM4 A320"),
  bucketEntry("motherboard", "AM4 B450 unknown", "B450", "AM4 B450"),
  bucketEntry("motherboard", "AM4 B550 unknown", "B550", "AM4 B550"),
  bucketEntry("motherboard", "AM4 B550 ASUS", "ASUS B550", "AM4 ASUS B550"),
  bucketEntry("motherboard", "AM4 B550 MSI", "MSI B550", "AM4 MSI B550"),
  bucketEntry("motherboard", "LGA1151 B365 unknown", "B365", "B365M", "ASUS PRIME B365M", "B365M-A"),
  bucketEntry("motherboard", "LGA1200 B460 unknown", "B460", "LGA1200 B460"),
  bucketEntry("motherboard", "LGA1700 H610 unknown", "H610", "LGA1700 H610"),
  bucketEntry("motherboard", "LGA1700 B660 unknown", "B660", "LGA1700 B660"),
  bucketEntry("motherboard", "LGA1700 B760 unknown", "B760", "B760M", "LGA1700 B760", "MAG B760M", "\uBC15\uACA9\uD3EC B760M"),
  bucketEntry("motherboard", "LGA1700 Z790 unknown", "Z790", "Z790-F", "Z790M", "ROG STRIX Z790"),
  bucketEntry("motherboard", "AM5 A620 unknown", "A620", "A620M", "AM5 A620"),
  bucketEntry("motherboard", "AM5 B650 unknown", "B650", "AM5 B650"),
  bucketEntry("motherboard", "AM5 B650 ASUS", "ASUS B650", "AM5 ASUS B650"),
  bucketEntry("motherboard", "AM5 B650 MSI", "MSI B650", "AM5 MSI B650"),
  bucketEntry("motherboard", "AM5 X870 unknown", "X870", "AM5 X870"),
  bucketEntry("motherboard", "AM4 A320 unknown", "A320M", "EX A320M-GAMING", "ASUS EX A320M-GAMING"),
  bucketEntry("motherboard", "AM4 B550 unknown", "\uBA54\uC778\uBCF4\uB4DC B550"),
  bucketEntry("motherboard", "AM4 B550 ASUS", "\uBA54\uC778\uBCF4\uB4DC ASUS B550")
];

export const LISTING_TITLE_HINTS: ListingTitleHintEntry[] = [
  {
    listingType: "full_pc",
    patterns: [
      loosePattern("full pc"),
      loosePattern("gaming pc"),
      loosePattern("desktop pc"),
      loosePattern("tower pc"),
      loosePattern("gaming desktop"),
      loosePattern("mini pc"),
      loosePattern("complete pc"),
      loosePattern("system unit"),
      loosePattern("iMac"),
      /\uBCF8\uCCB4/i,
      /\uC870\uB9BD\s*pc/i,
      /\uC544\uC774\uB9E5/i,
      /\uB370\uC2A4\uD06C\uD0D1(?!\uC6A9)(?:\s*(?:pc|\uCEF4\uD4E8\uD130))?/i,
      /\uCEF4\uD4E8\uD130\s*\uBCF8\uCCB4/i,
      /\uAC8C\uC774\uBC0D\s*(?:pc|\uCEF4\uD4E8\uD130|\uB370\uC2A4\uD06C\uD0D1)/i,
      /\uB370\uC2A4\uD06C\uD0D1(?!\uC6A9).*(?:\uD31D\uB2C8\uB2E4|\uD310\uB9E4)/i
    ]
  },
  {
    listingType: "semi_pc",
    patterns: [
      loosePattern("semi pc"),
      loosePattern("half pc"),
      loosePattern("bare bone"),
      loosePattern("base unit"),
      loosePattern("cpu + ram"),
      loosePattern("cpu + ssd")
    ]
  },
  {
    listingType: "part",
    patterns: [
      wordPattern("gpu"),
      wordPattern("cpu"),
      wordPattern("ram"),
      wordPattern("ssd"),
      loosePattern("graphics card"),
      loosePattern("video card"),
      loosePattern("motherboard"),
      wordPattern("mobo"),
      wordPattern("psu"),
      loosePattern("power supply"),
      /\uBA54\uC778\uBCF4\uB4DC/i,
      /\uD30C\uC6CC/i
    ]
  }
];
