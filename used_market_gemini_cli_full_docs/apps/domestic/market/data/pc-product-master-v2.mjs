export const PC_PRODUCT_MASTER_V2_VERSION = 5;
export const PC_UNCLASSIFIED_MANUFACTURER_V3 = "기타/미분류 제조사";

export const PC_GPU_BOARD_MANUFACTURERS_V2 = Object.freeze([
  "NVIDIA", "AMD", "Intel", "ASUS", "Colorful", "EVGA", "Gainward", "GALAX", "GIGABYTE",
  "Inno3D", "MSI", "Palit", "PNY", "PowerColor", "Sapphire", "XFX", "ZOTAC"
]);

const CATEGORY_SEEDS = [
  ["GPU", "GPU", ["NVIDIA", "AMD", "Intel"], ["GeForce", "Radeon", "Arc"]],
  ["CPU", "CPU", ["Intel", "AMD"], ["Core", "Core Ultra", "Ryzen"]],
  ["RAM", "RAM", ["Samsung", "SK hynix", "Micron", "Kingston", "Corsair", "G.Skill", "Crucial", "TeamGroup"], ["Memory Module"]],
  ["MOTHERBOARD", "메인보드", ["ASUS", "GIGABYTE", "MSI", "ASRock", "Biostar"], ["ROG", "TUF", "Prime", "AORUS", "MPG", "MAG", "MEG", "Taichi", "Steel Legend"]],
  ["SSD", "SSD", ["Samsung", "SK hynix", "Solidigm", "Crucial", "Western Digital", "SanDisk", "Kingston", "Seagate", "Kioxia", PC_UNCLASSIFIED_MANUFACTURER_V3], ["SSD"]],
  ["HDD", "HDD", ["Western Digital", "Seagate", "Toshiba", PC_UNCLASSIFIED_MANUFACTURER_V3], ["Blue", "Black", "Red", "Purple", "Gold", "IronWolf", "Barracuda", "Exos", "N300", "X300"]],
  ["PSU", "파워", ["Seasonic", "Corsair", "FSP", "Super Flower", "Cooler Master", "ASUS", "MSI", "Thermaltake", "be quiet!", "Antec", "Micronics", PC_UNCLASSIFIED_MANUFACTURER_V3], ["Power Supply"]],
  ["COOLING", "쿨러", ["Noctua", "Cooler Master", "Thermalright", "DeepCool", "ARCTIC", "Corsair", "NZXT", "be quiet!", "Scythe", "Thermaltake"], ["Air Cooler", "AIO", "Case Fan", "Custom Loop"]],
  ["CASE", "케이스", ["Corsair", "Cooler Master", "Lian Li", "Fractal Design", "NZXT", "Phanteks", "Thermaltake", "Antec", "3RSYS", "darkFlash", "ABKO", "Micronics"], ["PC Case"]],
  ["EXPANSION_CARD", "확장카드", ["ASUS", "Creative", "Elgato", "Blackmagic Design", "Intel", "Broadcom", "TP-Link", "QNAP", "HighPoint", "StarTech"], ["Network", "Sound", "Capture", "Storage Controller", "M.2 Carrier", "Thunderbolt"]],
  ["ODD", "ODD", ["ASUS", "LG", "Pioneer", "Samsung"], ["DVD", "Blu-ray", "BDXL"]]
];

export const PC_PART_CATEGORY_SEEDS_V2 = Object.freeze(CATEGORY_SEEDS.map(([code, label, manufacturers, brands], order) => Object.freeze({
  code,
  label,
  order,
  manufacturers: Object.freeze([...manufacturers]),
  brands: Object.freeze([...brands])
})));

const FACET_SCHEMA = {
  GPU: {
    // The canonical chip model is the primary browse key. Values are derived
    // from PRODUCT rows rather than hard-coded so new SKUs can be promoted
    // without changing this schema.
    gpu_model: [],
    chip_manufacturer: ["NVIDIA", "AMD", "Intel"],
    board_manufacturer: PC_GPU_BOARD_MANUFACTURERS_V2,
    market_segment: ["DESKTOP", "MOBILE", "WORKSTATION", "INTEGRATED"],
    family: ["GeForce GTX", "GeForce RTX", "Radeon RX", "Radeon Vega", "Intel Arc"],
    generation: ["GTX 900", "GTX 10", "GTX 16", "RTX 20", "RTX 30", "RTX 40", "RTX 50", "RX 400", "RX 500", "Vega", "RX 5000", "RX 6000", "RX 7000", "RX 9000", "Arc A", "Arc B"],
    vram_gb: [2, 3, 4, 6, 8, 10, 11, 12, 16, 20, 24, 32]
  },
  CPU: {
    platform_vendor: ["Intel", "AMD"],
    market_segment: ["DESKTOP", "MOBILE", "SERVER"],
    family: ["Core", "Core Ultra", "Ryzen"],
    generation: ["6th", "7th", "8th", "9th", "10th", "11th", "12th", "13th", "14th", "Core Ultra 200S", "Ryzen 1000", "Ryzen 2000", "Ryzen 3000", "Ryzen 4000", "Ryzen 5000", "Ryzen 7000", "Ryzen 8000", "Ryzen 9000"],
    socket: ["LGA1151", "LGA1200", "LGA1700", "LGA1851", "AM4", "AM5"],
    suffix: ["NONE", "F", "K", "KF", "KS", "G", "X", "XT", "X3D"]
  },
  RAM: {
    memory_generation: ["DDR3", "DDR4", "DDR5"],
    module_capacity_gb: [4, 8, 16, 24, 32, 48, 64, 96, 128],
    form_factor: ["DIMM", "SODIMM"],
    ecc: ["NON_ECC", "ECC"],
    buffering: ["UDIMM", "RDIMM", "SODIMM"]
  },
  MOTHERBOARD: {
    platform_vendor: ["Intel", "AMD"],
    socket: ["LGA1151", "LGA1200", "LGA1700", "LGA1851", "AM4", "AM5"],
    chipset: ["H110", "B150", "Z170", "B250", "Z270", "B360", "B365", "Z370", "Z390", "B460", "Z490", "B560", "Z590", "H610", "B660", "Z690", "B760", "Z790", "B860", "Z890", "A320", "B350", "X370", "B450", "X470", "A520", "B550", "X570", "A620", "B650", "X670", "B840", "B850", "X870"],
    form_factor: ["Mini-ITX", "Micro-ATX", "ATX", "E-ATX"],
    memory_generation: ["DDR3", "DDR4", "DDR5"]
  },
  SSD: {
    capacity_bucket: ["LE_256_GB", "257_512_GB", "513_GB_1_TB", "GT_1_TB_LE_2_TB", "GT_2_TB_LE_4_TB", "GT_4_TB_LE_8_TB", "GT_8_TB"],
    form_factor: ["2.5-inch", "M.2 2242", "M.2 2260", "M.2 2280", "M.2 22110", "U.2", "AIC"],
    interface: ["SATA", "PCIe"],
    protocol: ["AHCI", "NVMe"],
    pcie_generation: [3, 4, 5]
  },
  HDD: {
    capacity_bucket: ["LE_1_TB", "GT_1_TB_LE_2_TB", "GT_2_TB_LE_4_TB", "GT_4_TB_LE_6_TB", "GT_6_TB_LE_8_TB", "GT_8_TB_LE_12_TB", "GT_12_TB_LE_16_TB", "GT_16_TB_LE_20_TB", "GT_20_TB_LE_24_TB", "GT_24_TB"],
    use_class: ["DESKTOP", "PERFORMANCE", "NAS", "SURVEILLANCE", "ENTERPRISE"],
    form_factor: ["2.5-inch", "3.5-inch"],
    interface: ["SATA", "SAS"],
    recording_technology: ["CMR", "SMR", "UNKNOWN"]
  },
  PSU: {
    watts_bucket: ["LE_500", "501_650", "651_750", "751_850", "851_1000", "1001_1200", "GT_1200"],
    form_factor: ["ATX", "SFX", "SFX-L"],
    atx_spec: ["ATX 2.x", "ATX 3.0", "ATX 3.1"],
    modularity: ["NON_MODULAR", "SEMI_MODULAR", "FULL_MODULAR"],
    efficiency: ["80 PLUS", "80 PLUS Bronze", "80 PLUS Gold", "80 PLUS Platinum", "80 PLUS Titanium"]
  },
  COOLING: {
    subtype: ["AIR_CPU", "AIO", "CUSTOM_LOOP", "CASE_FAN", "THERMAL_ACCESSORY"],
    radiator_mm: [120, 240, 280, 360, 420],
    fan_mm: [40, 60, 80, 92, 120, 140, 200],
    socket: ["LGA1151", "LGA1200", "LGA1700", "LGA1851", "AM4", "AM5"]
  },
  CASE: {
    chassis_class: ["MINI_TOWER", "MID_TOWER", "FULL_TOWER"],
    motherboard_support: ["Mini-ITX", "Micro-ATX", "ATX", "E-ATX"],
    side_panel: ["SOLID", "ACRYLIC", "TEMPERED_GLASS", "MESH"]
  },
  EXPANSION_CARD: {
    subtype: ["NETWORK", "SOUND", "CAPTURE", "HBA_RAID", "M2_CARRIER", "THUNDERBOLT_USB", "SERIAL_PARALLEL"],
    host_interface: ["PCIe x1", "PCIe x4", "PCIe x8", "PCIe x16"],
    bracket: ["LOW_PROFILE", "FULL_HEIGHT", "BOTH"]
  },
  ODD: {
    media_family: ["DVD", "Blu-ray", "BDXL"],
    capability: ["READER", "WRITER"],
    placement: ["INTERNAL", "EXTERNAL"],
    form_factor: ["5.25-inch", "SLIM"],
    interface: ["SATA", "USB", "USB Type-C"]
  }
};

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const PC_PART_FACET_SCHEMA_V2 = deepFreeze(FACET_SCHEMA);

function slug(value) {
  if (value === PC_UNCLASSIFIED_MANUFACTURER_V3) return "other-unclassified";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
}

function record({ id, name, category, group, manufacturer, brand, aliases = [], forbidden = [], spec = {}, browseFacets = {} }) {
  return {
    id,
    name,
    category,
    group,
    manufacturer,
    brand,
    aliases: [...new Set(aliases)],
    forbidden: [...new Set(forbidden)],
    spec: { directory_node_type: "PRODUCT", ...spec },
    browse_facets: { directory_node_type: "PRODUCT", ...browseFacets }
  };
}

const NVIDIA_GPU_FAMILIES = [
  ["GTX 900", [
    ["GTX 950", [2]], ["GTX 960", [2, 4]], ["GTX 970", [4]], ["GTX 980", [4]], ["GTX 980 Ti", [6]]
  ]],
  ["GTX 10", [
    ["GTX 1050", [2, 3]], ["GTX 1050 Ti", [4]], ["GTX 1060", [3, 6]], ["GTX 1070", [8]], ["GTX 1070 Ti", [8]], ["GTX 1080", [8]], ["GTX 1080 Ti", [11]]
  ]],
  ["GTX 16", [
    ["GTX 1630", [4]], ["GTX 1650", [4]], ["GTX 1650 SUPER", [4]], ["GTX 1660", [6]], ["GTX 1660 SUPER", [6]], ["GTX 1660 Ti", [6]]
  ]],
  ["RTX 20", [
    ["RTX 2060", [6, 12]], ["RTX 2060 SUPER", [8]], ["RTX 2070", [8]], ["RTX 2070 SUPER", [8]], ["RTX 2080", [8]], ["RTX 2080 SUPER", [8]], ["RTX 2080 Ti", [11]]
  ]],
  ["RTX 30", [
    ["RTX 3050", [6, 8]], ["RTX 3060", [8, 12]], ["RTX 3060 Ti", [8]], ["RTX 3070", [8]], ["RTX 3070 Ti", [8]], ["RTX 3080", [10, 12]], ["RTX 3080 Ti", [12]], ["RTX 3090", [24]], ["RTX 3090 Ti", [24]]
  ]],
  ["RTX 40", [
    ["RTX 4060", [8]], ["RTX 4060 Ti", [8, 16]], ["RTX 4070", [12]], ["RTX 4070 SUPER", [12]], ["RTX 4070 Ti", [12]], ["RTX 4070 Ti SUPER", [16]], ["RTX 4080", [16]], ["RTX 4080 SUPER", [16]], ["RTX 4090", [24]]
  ]],
  ["RTX 50", [
    ["RTX 5050", [8]], ["RTX 5060", [8]], ["RTX 5060 Ti", [8, 16]], ["RTX 5070", [12]], ["RTX 5070 Ti", [16]], ["RTX 5080", [16]], ["RTX 5090", [32]]
  ]]
];

const AMD_GPU_FAMILIES = [
  ["RX 400", [["RX 460", [2, 4]], ["RX 470", [4, 8]], ["RX 480", [4, 8]]]],
  ["RX 500", [["RX 550", [2, 4]], ["RX 560", [2, 4]], ["RX 570", [4, 8]], ["RX 580", [4, 8]], ["RX 590", [8]]]],
  ["Vega", [["RX Vega 56", [8]], ["RX Vega 64", [8]], ["Radeon VII", [16]]]],
  ["RX 5000", [["RX 5500 XT", [4, 8]], ["RX 5600 XT", [6]], ["RX 5700", [8]], ["RX 5700 XT", [8]]]],
  ["RX 6000", [["RX 6400", [4]], ["RX 6500 XT", [4, 8]], ["RX 6600", [8]], ["RX 6600 XT", [8]], ["RX 6650 XT", [8]], ["RX 6700", [10]], ["RX 6700 XT", [12]], ["RX 6750 XT", [12]], ["RX 6800", [16]], ["RX 6800 XT", [16]], ["RX 6900 XT", [16]], ["RX 6950 XT", [16]]]],
  ["RX 7000", [["RX 7600", [8]], ["RX 7600 XT", [16]], ["RX 7700 XT", [12]], ["RX 7800 XT", [16]], ["RX 7900 GRE", [16]], ["RX 7900 XT", [20]], ["RX 7900 XTX", [24]]]],
  ["RX 9000", [["RX 9060 XT", [8, 16]], ["RX 9070", [16]], ["RX 9070 XT", [16]]]]
];

const INTEL_GPU_FAMILIES = [
  ["Arc A", [["Arc A310", [4]], ["Arc A380", [6]], ["Arc A580", [8]], ["Arc A750", [8]], ["Arc A770", [8, 16]]]],
  ["Arc B", [["Arc B570", [10]], ["Arc B580", [12]]]]
];

function gpuRecords(manufacturer, brand, families) {
  return families.flatMap(([generation, models]) => models.map(([model, vramOptions]) => record({
    id: `gpu:${manufacturer.toLowerCase()}:${slug(model)}`,
    name: model.startsWith(brand) ? `${manufacturer} ${model}` : `${manufacturer} ${brand} ${model}`,
    category: "GPU",
    group: `gpu:${manufacturer.toLowerCase()}:${slug(generation)}`,
    manufacturer,
    brand,
    aliases: [model, ...vramOptions.map((vram) => `${model} ${vram}GB`)],
    forbidden: [`${model} 박스만`, `${model} 쿨러만`],
    spec: {
      chip_manufacturer: manufacturer,
      board_manufacturer: null,
      manufacturer_roles: { chip: manufacturer, board: null },
      gpu_model: model,
      vram_options_gb: vramOptions,
      market_segment: "DESKTOP"
    },
    browseFacets: {
      chip_manufacturer: manufacturer,
      board_manufacturer: null,
      market_segment: "DESKTOP",
      gpu_model: model,
      family: manufacturer === "NVIDIA" ? `GeForce ${model.split(" ")[0]}` : manufacturer === "AMD" ? (generation === "Vega" ? "Radeon Vega" : "Radeon RX") : "Intel Arc",
      generation,
      vram_gb: vramOptions
    }
  })));
}

const INTEL_CPU_GENERATIONS = [
  [6, "LGA1151", ["i3-6100", "i5-6400", "i5-6500", "i5-6600K", "i7-6700", "i7-6700K"]],
  [7, "LGA1151", ["i3-7100", "i5-7400", "i5-7500", "i5-7600K", "i7-7700", "i7-7700K"]],
  [8, "LGA1151", ["i3-8100", "i5-8400", "i5-8500", "i5-8600K", "i7-8700", "i7-8700K"]],
  [9, "LGA1151", ["i3-9100F", "i5-9400F", "i5-9500", "i5-9600K", "i5-9600KF", "i7-9700", "i7-9700F", "i7-9700K", "i9-9900K", "i9-9900KF"]],
  [10, "LGA1200", ["i3-10100", "i3-10100F", "i5-10400", "i5-10400F", "i5-10600K", "i5-10600KF", "i7-10700", "i7-10700F", "i7-10700K", "i7-10700KF", "i9-10900", "i9-10900F", "i9-10900K", "i9-10900KF"]],
  [11, "LGA1200", ["i5-11400", "i5-11400F", "i5-11600K", "i5-11600KF", "i7-11700", "i7-11700F", "i7-11700K", "i7-11700KF", "i9-11900K", "i9-11900KF"]],
  [12, "LGA1700", ["i3-12100", "i3-12100F", "i5-12400", "i5-12400F", "i5-12600", "i5-12600K", "i5-12600KF", "i7-12700", "i7-12700F", "i7-12700K", "i7-12700KF", "i9-12900", "i9-12900F", "i9-12900K", "i9-12900KF", "i9-12900KS"]],
  [13, "LGA1700", ["i3-13100", "i3-13100F", "i5-13400", "i5-13400F", "i5-13500", "i5-13600K", "i5-13600KF", "i7-13700", "i7-13700F", "i7-13700K", "i7-13700KF", "i9-13900", "i9-13900F", "i9-13900K", "i9-13900KF", "i9-13900KS"]],
  [14, "LGA1700", ["i3-14100", "i3-14100F", "i5-14400", "i5-14400F", "i5-14500", "i5-14600K", "i5-14600KF", "i7-14700", "i7-14700F", "i7-14700K", "i7-14700KF", "i9-14900", "i9-14900F", "i9-14900K", "i9-14900KF", "i9-14900KS"]]
];

function suffixOf(model) {
  return model.match(/(X3D|KF|KS|XT|K|F|G|X)$/u)?.[1] || "NONE";
}

function intelCpuRecords() {
  const core = INTEL_CPU_GENERATIONS.flatMap(([generation, socket, models]) => models.map((model) => record({
    id: `cpu:intel:${slug(model)}`,
    name: `Intel Core ${model}`,
    category: "CPU",
    group: `cpu:intel:core:${generation}th`,
    manufacturer: "Intel",
    brand: "Core",
    aliases: [`Intel Core ${model}`, model, model.replace("-", " "), model.split("-")[1]],
    forbidden: [`${model} 박스만`, `${model} 쿨러`],
    spec: { platform_vendor: "Intel", cpu_model: model, generation, socket, suffix: suffixOf(model), market_segment: "DESKTOP" },
    browseFacets: { platform_vendor: "Intel", market_segment: "DESKTOP", family: "Core", generation: `${generation}th`, socket, suffix: suffixOf(model) }
  })));
  const ultraModels = ["Ultra 5 225", "Ultra 5 225F", "Ultra 5 235", "Ultra 5 245", "Ultra 5 245K", "Ultra 5 245KF", "Ultra 7 265", "Ultra 7 265F", "Ultra 7 265K", "Ultra 7 265KF", "Ultra 9 285", "Ultra 9 285K"];
  const ultra = ultraModels.map((model) => record({
    id: `cpu:intel:core-${slug(model)}`,
    name: `Intel Core ${model}`,
    category: "CPU",
    group: "cpu:intel:core-ultra:200s",
    manufacturer: "Intel",
    brand: "Core Ultra",
    aliases: [`Intel Core ${model}`, `Core ${model}`, model],
    forbidden: [`${model} 박스만`, `${model} 쿨러`],
    spec: { platform_vendor: "Intel", cpu_model: model, generation: "Core Ultra 200S", socket: "LGA1851", suffix: suffixOf(model), market_segment: "DESKTOP" },
    browseFacets: { platform_vendor: "Intel", market_segment: "DESKTOP", family: "Core Ultra", generation: "Core Ultra 200S", socket: "LGA1851", suffix: suffixOf(model) }
  }));
  return [...core, ...ultra];
}

const AMD_CPU_GENERATIONS = [
  [1000, "AM4", ["Ryzen 3 1200", "Ryzen 3 1300X", "Ryzen 5 1400", "Ryzen 5 1500X", "Ryzen 5 1600", "Ryzen 5 1600X", "Ryzen 7 1700", "Ryzen 7 1700X", "Ryzen 7 1800X"]],
  [2000, "AM4", ["Ryzen 3 2200G", "Ryzen 5 2400G", "Ryzen 5 2600", "Ryzen 5 2600X", "Ryzen 7 2700", "Ryzen 7 2700X"]],
  [3000, "AM4", ["Ryzen 3 3100", "Ryzen 3 3200G", "Ryzen 3 3300X", "Ryzen 5 3400G", "Ryzen 5 3500X", "Ryzen 5 3600", "Ryzen 5 3600X", "Ryzen 5 3600XT", "Ryzen 7 3700X", "Ryzen 7 3800X", "Ryzen 7 3800XT", "Ryzen 9 3900X", "Ryzen 9 3900XT", "Ryzen 9 3950X"]],
  [4000, "AM4", ["Ryzen 3 4100", "Ryzen 3 4300G", "Ryzen 5 4500", "Ryzen 5 4600G", "Ryzen 7 4700G"]],
  [5000, "AM4", ["Ryzen 5 5500", "Ryzen 5 5600", "Ryzen 5 5600G", "Ryzen 5 5600X", "Ryzen 5 5600X3D", "Ryzen 7 5700", "Ryzen 7 5700G", "Ryzen 7 5700X", "Ryzen 7 5700X3D", "Ryzen 7 5800", "Ryzen 7 5800X", "Ryzen 7 5800X3D", "Ryzen 9 5900X", "Ryzen 9 5950X"]],
  [7000, "AM5", ["Ryzen 5 7500F", "Ryzen 5 7600", "Ryzen 5 7600X", "Ryzen 5 7600X3D", "Ryzen 7 7700", "Ryzen 7 7700X", "Ryzen 7 7800X3D", "Ryzen 9 7900", "Ryzen 9 7900X", "Ryzen 9 7900X3D", "Ryzen 9 7950X", "Ryzen 9 7950X3D"]],
  [8000, "AM5", ["Ryzen 3 8300G", "Ryzen 5 8400F", "Ryzen 5 8500G", "Ryzen 5 8600G", "Ryzen 7 8700F", "Ryzen 7 8700G"]],
  [9000, "AM5", ["Ryzen 5 9600X", "Ryzen 5 9600X3D", "Ryzen 7 9700X", "Ryzen 7 9800X3D", "Ryzen 9 9900X", "Ryzen 9 9900X3D", "Ryzen 9 9950X", "Ryzen 9 9950X3D"]]
];

function amdCpuRecords() {
  return AMD_CPU_GENERATIONS.flatMap(([generation, socket, models]) => models.map((name) => {
    const model = name.replace(/^Ryzen [3579] /u, "");
    return record({
      id: `cpu:amd:${slug(name)}`,
      name: `AMD ${name}`,
      category: "CPU",
      group: `cpu:amd:ryzen:${generation}`,
      manufacturer: "AMD",
      brand: "Ryzen",
      aliases: [`AMD ${name}`, name, model],
      forbidden: [
        `${model} 박스만`,
        `${model} 쿨러`,
        ...(model === "1200" ? ["1200", "LGA1200", "LGA 1200", "1200소켓", "1200 소켓"] : [])
      ],
      spec: { platform_vendor: "AMD", cpu_model: model, generation: `Ryzen ${generation}`, socket, suffix: suffixOf(model), market_segment: "DESKTOP" },
      browseFacets: { platform_vendor: "AMD", market_segment: "DESKTOP", family: "Ryzen", generation: `Ryzen ${generation}`, socket, suffix: suffixOf(model) }
    });
  }));
}

const RAM_CAPACITIES_GB = [4, 8, 16, 24, 32, 48, 64, 96, 128];

function categoryManufacturers(category) {
  return PC_PART_CATEGORY_SEEDS_V2.find((entry) => entry.code === category)?.manufacturers || [];
}

function ramRecords() {
  return ["DDR3", "DDR4", "DDR5"].flatMap((generation) => RAM_CAPACITIES_GB.flatMap((capacity) => categoryManufacturers("RAM").map((manufacturer) => record({
    id: `ram:${slug(manufacturer)}:${generation.toLowerCase()}:${capacity}gb`,
    name: `${manufacturer} ${generation} ${capacity}GB Memory Module`,
    category: "RAM",
    group: `ram:${generation.toLowerCase()}:module-capacity`,
    manufacturer,
    brand: "Memory Module",
    aliases: [
      `${manufacturer} ${generation} ${capacity}GB`,
      `${generation} ${capacity}GB ${manufacturer}`,
      `${manufacturer} ${capacity}GB ${generation}`
    ],
    forbidden: ["메모리 방열판", "RAM 방열판", "박스만"],
    spec: { memory_generation: generation, module_capacity_gb: capacity, module_count: 1 },
    browseFacets: { memory_generation: generation, module_capacity_gb: capacity }
  }))));
}

export const PC_SSD_CAPACITY_BUCKETS_V3 = Object.freeze([
  ["LE_256_GB", "SSD up to 256GB", [120, 128, 240, 250, 256]],
  ["257_512_GB", "SSD 257-512GB", [400, 480, 500, 512]],
  ["513_GB_1_TB", "SSD 513GB-1TB", [800, 960, 1000]],
  ["GT_1_TB_LE_2_TB", "SSD over 1TB up to 2TB", [1600, 1920, 2000]],
  ["GT_2_TB_LE_4_TB", "SSD over 2TB up to 4TB", [3200, 3840, 4000]],
  ["GT_4_TB_LE_8_TB", "SSD over 4TB up to 8TB", [5000, 7680, 8000]],
  ["GT_8_TB", "SSD over 8TB", [15360, 16000]]
]);

export const PC_HDD_CAPACITY_BUCKETS_V3 = Object.freeze([
  ["LE_1_TB", "HDD up to 1TB", [500, 1000]],
  ["GT_1_TB_LE_2_TB", "HDD over 1TB up to 2TB", [1500, 2000]],
  ["GT_2_TB_LE_4_TB", "HDD over 2TB up to 4TB", [3000, 4000]],
  ["GT_4_TB_LE_6_TB", "HDD over 4TB up to 6TB", [5000, 6000]],
  ["GT_6_TB_LE_8_TB", "HDD over 6TB up to 8TB", [7000, 8000]],
  ["GT_8_TB_LE_12_TB", "HDD over 8TB up to 12TB", [10000, 12000]],
  ["GT_12_TB_LE_16_TB", "HDD over 12TB up to 16TB", [14000, 16000]],
  ["GT_16_TB_LE_20_TB", "HDD over 16TB up to 20TB", [18000, 20000]],
  ["GT_20_TB_LE_24_TB", "HDD over 20TB up to 24TB", [22000, 24000]],
  ["GT_24_TB", "HDD over 24TB", [26000, 28000, 30000, 32000]]
]);

export const PC_PSU_WATTS_BUCKETS_V3 = Object.freeze([
  ["LE_500", "Power Supply up to 500W", [300, 400, 500]],
  ["501_650", "Power Supply 501-650W", [520, 550, 600, 650]],
  ["651_750", "Power Supply 651-750W", [700, 750]],
  ["751_850", "Power Supply 751-850W", [800, 850]],
  ["851_1000", "Power Supply 851-1000W", [900, 1000]],
  ["1001_1200", "Power Supply 1001-1200W", [1050, 1100, 1200]],
  ["GT_1200", "Power Supply over 1200W", [1300, 1500, 1600]]
]);

export function pcStorageCapacityBucketV3(category, capacityGb) {
  const value = Number(capacityGb);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (category === "SSD") {
    if (value <= 256) return "LE_256_GB";
    if (value <= 512) return "257_512_GB";
    if (value <= 1024) return "513_GB_1_TB";
    if (value <= 2048) return "GT_1_TB_LE_2_TB";
    if (value <= 4096) return "GT_2_TB_LE_4_TB";
    if (value <= 8192) return "GT_4_TB_LE_8_TB";
    return "GT_8_TB";
  }
  if (category === "HDD") {
    if (value <= 1000) return "LE_1_TB";
    if (value <= 2000) return "GT_1_TB_LE_2_TB";
    if (value <= 4000) return "GT_2_TB_LE_4_TB";
    if (value <= 6000) return "GT_4_TB_LE_6_TB";
    if (value <= 8000) return "GT_6_TB_LE_8_TB";
    if (value <= 12000) return "GT_8_TB_LE_12_TB";
    if (value <= 16000) return "GT_12_TB_LE_16_TB";
    if (value <= 20000) return "GT_16_TB_LE_20_TB";
    if (value <= 24000) return "GT_20_TB_LE_24_TB";
    return "GT_24_TB";
  }
  return null;
}

export function pcPsuWattsBucketV3(ratedWatts) {
  const value = Number(ratedWatts);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value <= 500) return "LE_500";
  if (value <= 650) return "501_650";
  if (value <= 750) return "651_750";
  if (value <= 850) return "751_850";
  if (value <= 1000) return "851_1000";
  if (value <= 1200) return "1001_1200";
  return "GT_1200";
}

export function pcAggregateProductIdV3({ category, manufacturer, capacityGb = null, ratedWatts = null }) {
  const normalizedCategory = String(category || "").toUpperCase();
  const normalizedManufacturer = manufacturer || PC_UNCLASSIFIED_MANUFACTURER_V3;
  const bucket = normalizedCategory === "PSU"
    ? pcPsuWattsBucketV3(ratedWatts)
    : pcStorageCapacityBucketV3(normalizedCategory, capacityGb);
  if (!bucket || !["SSD", "HDD", "PSU"].includes(normalizedCategory)) return null;
  const dimension = normalizedCategory === "PSU" ? "watts-bucket" : "capacity-bucket";
  return `${normalizedCategory.toLowerCase()}:${slug(normalizedManufacturer)}:${dimension}:${slug(bucket)}`;
}

const EXTRA_AGGREGATE_ALIASES = Object.freeze({
  "ssd:samsung:capacity-bucket:513-gb-1-tb": ["990 PRO", "Samsung 990 PRO 1TB", "990 PRO 1TB", "Samsung M.2 SATA 1TB", "M.2 SATA 1TB"],
  "ssd:samsung:capacity-bucket:gt-1-tb-le-2-tb": ["990 PRO", "Samsung 990 PRO 2TB", "990 PRO 2TB"],
  "hdd:seagate:capacity-bucket:gt-12-tb-le-16-tb": ["Seagate ST16000DM001 16TB", "ST16000DM001 16TB"],
  "psu:micronics:watts-bucket:le-500": ["Micronics Classic II 500W", "Classic II 500W", "클래식2 500W"],
  "psu:micronics:watts-bucket:501-650": ["Micronics Classic II 600W", "Classic II 600W", "클래식2 600W"],
  "psu:fsp:watts-bucket:501-650": ["FSP HYDRO PRO 600W", "HYDRO PRO 600W", "하이드로 프로 600W"],
  "psu:micronics:watts-bucket:651-750": ["Micronics Classic II 700W", "Classic II 700W", "클래식2 700W"],
  "psu:seasonic:watts-bucket:651-750": ["Seasonic FOCUS GOLD GX-750", "FOCUS GOLD GX-750", "포커스 골드 750W"],
  "psu:seasonic:watts-bucket:751-850": ["Seasonic VERTEX GX-850", "VERTEX GX-850 850W"],
  "psu:super-flower:watts-bucket:751-850": ["SuperFlower LEADEX III GOLD 850W", "LEADEX III GOLD 850W", "리덱스 3 850W"],
  "psu:seasonic:watts-bucket:851-1000": ["Seasonic FOCUS GOLD GX-1000", "FOCUS GOLD GX-1000", "포커스 골드 1000W"],
  "psu:corsair:watts-bucket:851-1000": ["Corsair RM1000x", "커세어 RM1000x"]
});

function capacityBucketRecords(category, buckets) {
  const auxiliary = category === "SSD"
    ? { form_factor: ["2.5-inch", "M.2 2280"], interface: ["SATA", "PCIe"], protocol: ["AHCI", "NVMe"] }
    : { form_factor: ["2.5-inch", "3.5-inch"], interface: ["SATA", "SAS"], use_class: ["DESKTOP", "NAS", "SURVEILLANCE", "ENTERPRISE"] };
  return buckets.flatMap(([capacityBucket, name, capacityExamplesGb]) => categoryManufacturers(category).map((manufacturer) => ({
    ...record({
      id: `${category.toLowerCase()}:${slug(manufacturer)}:capacity-bucket:${slug(capacityBucket)}`,
      name: `${manufacturer} ${name}`,
      category,
      group: `${category.toLowerCase()}:capacity-bucket`,
      manufacturer,
      brand: category,
      aliases: [
        `${manufacturer} ${name}`,
        ...capacityExamplesGb.map((capacity) => `${manufacturer} ${capacity >= 1000 && capacity % 1000 === 0 ? capacity / 1000 : capacity}${capacity >= 1000 && capacity % 1000 === 0 ? "TB" : "GB"} ${category}`),
        ...(EXTRA_AGGREGATE_ALIASES[`${category.toLowerCase()}:${slug(manufacturer)}:capacity-bucket:${slug(capacityBucket)}`] || [])
      ],
      spec: { capacity_bucket: capacityBucket, capacity_examples_gb: capacityExamplesGb, ...auxiliary },
      browseFacets: { capacity_bucket: capacityBucket, ...auxiliary }
    }),
    spec: { directory_node_type: "BROWSE_BUCKET", capacity_bucket: capacityBucket, capacity_examples_gb: capacityExamplesGb, ...auxiliary },
    browse_facets: { directory_node_type: "BROWSE_BUCKET", capacity_bucket: capacityBucket, ...auxiliary }
  })));
}

function wattsBucketRecords() {
  return PC_PSU_WATTS_BUCKETS_V3.flatMap(([wattsBucket, name, wattsExamples]) => categoryManufacturers("PSU").map((manufacturer) => {
    const id = `psu:${slug(manufacturer)}:watts-bucket:${slug(wattsBucket)}`;
    return {
      ...record({
        id,
        name: `${manufacturer} ${name}`,
        category: "PSU",
        group: "psu:watts-bucket",
        manufacturer,
        brand: "Power Supply",
        aliases: [
          `${manufacturer} ${name}`,
          ...wattsExamples.map((watts) => `${manufacturer} ${watts}W Power Supply`),
          ...(EXTRA_AGGREGATE_ALIASES[id] || [])
        ],
        spec: {
          watts_bucket: wattsBucket, watts_examples: wattsExamples,
          form_factor: ["ATX", "SFX", "SFX-L"], atx_spec: ["ATX 2.x", "ATX 3.0", "ATX 3.1"],
          efficiency: ["80 PLUS", "80 PLUS Bronze", "80 PLUS Gold", "80 PLUS Platinum", "80 PLUS Titanium"],
          modularity: ["NON_MODULAR", "SEMI_MODULAR", "FULL_MODULAR"]
        },
        browseFacets: {
          watts_bucket: wattsBucket, form_factor: ["ATX", "SFX", "SFX-L"], atx_spec: ["ATX 2.x", "ATX 3.0", "ATX 3.1"],
          efficiency: ["80 PLUS", "80 PLUS Bronze", "80 PLUS Gold", "80 PLUS Platinum", "80 PLUS Titanium"],
          modularity: ["NON_MODULAR", "SEMI_MODULAR", "FULL_MODULAR"]
        }
      }),
      spec: {
        directory_node_type: "BROWSE_BUCKET", watts_bucket: wattsBucket, watts_examples: wattsExamples,
        form_factor: ["ATX", "SFX", "SFX-L"], atx_spec: ["ATX 2.x", "ATX 3.0", "ATX 3.1"],
        efficiency: ["80 PLUS", "80 PLUS Bronze", "80 PLUS Gold", "80 PLUS Platinum", "80 PLUS Titanium"],
        modularity: ["NON_MODULAR", "SEMI_MODULAR", "FULL_MODULAR"]
      },
      browse_facets: {
        directory_node_type: "BROWSE_BUCKET", watts_bucket: wattsBucket, form_factor: ["ATX", "SFX", "SFX-L"], atx_spec: ["ATX 2.x", "ATX 3.0", "ATX 3.1"],
        efficiency: ["80 PLUS", "80 PLUS Bronze", "80 PLUS Gold", "80 PLUS Platinum", "80 PLUS Titanium"],
        modularity: ["NON_MODULAR", "SEMI_MODULAR", "FULL_MODULAR"]
      }
    };
  }));
}

const OTHER_CATEGORY_NODES = [
  ["MOTHERBOARD", "motherboard:platform:intel", "Intel Desktop Motherboard Platform", "motherboard:intel", "Intel", "Motherboard", { platform_vendor: "Intel" }],
  ["MOTHERBOARD", "motherboard:platform:amd", "AMD Desktop Motherboard Platform", "motherboard:amd", "AMD", "Motherboard", { platform_vendor: "AMD" }],
  ["COOLING", "cooling:facet:air-cpu", "Air CPU Cooler", "cooling:subtype", "Generic", "Air Cooler", { subtype: "AIR_CPU" }],
  ["COOLING", "cooling:facet:aio", "AIO Liquid Cooler", "cooling:subtype", "Generic", "AIO", { subtype: "AIO" }],
  ["COOLING", "cooling:facet:case-fan", "PC Case Fan", "cooling:subtype", "Generic", "Case Fan", { subtype: "CASE_FAN" }],
  ["CASE", "case:facet:mini-tower", "Mini Tower PC Case", "case:chassis-class", "Generic", "PC Case", { chassis_class: "MINI_TOWER" }],
  ["CASE", "case:facet:mid-tower", "Mid Tower PC Case", "case:chassis-class", "Generic", "PC Case", { chassis_class: "MID_TOWER" }],
  ["CASE", "case:facet:full-tower", "Full Tower PC Case", "case:chassis-class", "Generic", "PC Case", { chassis_class: "FULL_TOWER" }],
  ["EXPANSION_CARD", "expansion:facet:network", "PCIe Network Card", "expansion:subtype", "Generic", "Network", { subtype: "NETWORK" }],
  ["EXPANSION_CARD", "expansion:facet:sound", "PCIe Sound Card", "expansion:subtype", "Generic", "Sound", { subtype: "SOUND" }],
  ["EXPANSION_CARD", "expansion:facet:capture", "PCIe Capture Card", "expansion:subtype", "Generic", "Capture", { subtype: "CAPTURE" }],
  ["EXPANSION_CARD", "expansion:facet:hba-raid", "PCIe HBA RAID Card", "expansion:subtype", "Generic", "Storage Controller", { subtype: "HBA_RAID" }],
  ["EXPANSION_CARD", "expansion:facet:m2-carrier", "PCIe M.2 Carrier Card", "expansion:subtype", "Generic", "M.2 Carrier", { subtype: "M2_CARRIER" }],
  ["ODD", "odd:facet:dvd-writer", "DVD Writer", "odd:media-family", "Generic", "DVD", { media_family: "DVD", capability: "WRITER" }],
  ["ODD", "odd:facet:blu-ray-writer", "Blu-ray Writer", "odd:media-family", "Generic", "Blu-ray", { media_family: "Blu-ray", capability: "WRITER" }],
  ["ODD", "odd:facet:bdxl-writer", "BDXL Writer", "odd:media-family", "Generic", "BDXL", { media_family: "BDXL", capability: "WRITER" }]
].flatMap(([category, id, name, group, _manufacturer, brand, facets]) => categoryManufacturers(category).map((manufacturer) => ({
  ...record({
    id: `${id}:${slug(manufacturer)}`,
    name: `${manufacturer} ${name}`,
    category,
    group,
    manufacturer,
    brand,
    aliases: [`${manufacturer} ${name}`],
    spec: facets,
    browseFacets: facets
  }),
  spec: { directory_node_type: "BROWSE_FACET", ...facets },
  browse_facets: { directory_node_type: "BROWSE_FACET", ...facets }
})));

function verifiedMotherboard({ manufacturer, model, family, platform, socket, chipset, formFactor, ddr, wifi = false,
  edition = null, revision = null, revisionRequired = false, verifiedRevisions = [], sourceUrl, aliases = [] }) {
  return record({
    id: `motherboard:${slug(manufacturer)}:${slug(model)}`,
    name: `${manufacturer} ${model}`,
    category: "MOTHERBOARD", group: `motherboard:${platform.toLowerCase()}:${chipset.toLowerCase()}`,
    manufacturer, brand: family,
    aliases: [model, `${manufacturer} ${model}`, ...aliases],
    spec: {
      official_model: model, exact_model: model, product_family: family, platform_vendor: platform,
      socket, chipset, form_factor: formFactor, memory_generation: ddr, wifi, wifi_variant: wifi ? "WIFI" : "NONE",
      edition, revision, revision_required: revisionRequired, verified_revisions: verifiedRevisions,
      official_source_urls: [sourceUrl]
    }
  });
}

const MOTHERBOARD_PRODUCTS = [
  record({
    id: "motherboard:asus:rog-strix-b550-a-gaming",
    name: "ASUS ROG STRIX B550-A GAMING",
    category: "MOTHERBOARD", group: "motherboard:amd:b550", manufacturer: "ASUS", brand: "ROG Strix",
    aliases: ["ROG STRIX B550-A GAMING", "ASUS ROG STRIX B550-A GAMING"],
    spec: {
      official_model: "ROG STRIX B550-A GAMING", exact_model: "ROG STRIX B550-A GAMING",
      product_family: "ROG Strix", platform_vendor: "AMD", socket: "AM4", chipset: "B550",
      form_factor: "ATX", memory_generation: "DDR4", wifi: false, wifi_variant: "NONE",
      edition: "A GAMING", revision: null,
      official_source_urls: ["https://rog.asus.com/motherboards/rog-strix/rog-strix-b550-a-gaming-model/"]
    }
  }),
  record({
    id: "motherboard:asus:tuf-gaming-b550-pro",
    name: "ASUS TUF GAMING B550-PRO",
    category: "MOTHERBOARD", group: "motherboard:amd:b550", manufacturer: "ASUS", brand: "TUF Gaming",
    aliases: ["TUF GAMING B550-PRO", "ASUS TUF GAMING B550-PRO"],
    spec: {
      official_model: "TUF GAMING B550-PRO", exact_model: "TUF GAMING B550-PRO",
      product_family: "TUF Gaming", platform_vendor: "AMD", socket: "AM4", chipset: "B550",
      form_factor: "ATX", memory_generation: "DDR4", wifi: false, wifi_variant: "NONE",
      edition: "PRO", revision: null,
      official_source_urls: ["https://www.asus.com/us/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b550-pro/"]
    }
  }),
  record({
    id: "motherboard:asus:prime-b550m-a",
    name: "ASUS PRIME B550M-A",
    category: "MOTHERBOARD", group: "motherboard:amd:b550", manufacturer: "ASUS", brand: "Prime",
    aliases: ["PRIME B550M-A", "ASUS PRIME B550M-A"],
    spec: {
      official_model: "PRIME B550M-A", exact_model: "PRIME B550M-A",
      product_family: "Prime", platform_vendor: "AMD", socket: "AM4", chipset: "B550",
      form_factor: "Micro-ATX", memory_generation: "DDR4", wifi: false, wifi_variant: "NONE",
      edition: "A", revision: null,
      official_source_urls: ["https://www.asus.com/motherboards-components/motherboards/prime/prime-b550m-a/"]
    }
  }),
  record({
    id: "motherboard:asus:rog-strix-b550-i-gaming",
    name: "ASUS ROG STRIX B550-I GAMING",
    category: "MOTHERBOARD", group: "motherboard:amd:b550", manufacturer: "ASUS", brand: "ROG Strix",
    aliases: ["ROG STRIX B550-I GAMING", "ASUS ROG STRIX B550-I GAMING"],
    spec: {
      official_model: "ROG STRIX B550-I GAMING", exact_model: "ROG STRIX B550-I GAMING",
      product_family: "ROG Strix", platform_vendor: "AMD", socket: "AM4", chipset: "B550",
      form_factor: "Mini-ITX", memory_generation: "DDR4", wifi: true, wifi_variant: "WIFI",
      edition: "I GAMING", revision: null,
      official_source_urls: ["https://rog.asus.com/motherboards/rog-strix/rog-strix-b550-i-gaming-model/spec/"]
    }
  }),
  record({
    id: "motherboard:msi:mag-b650m-mortar-wifi",
    name: "MSI MAG B650M MORTAR WIFI",
    category: "MOTHERBOARD", group: "motherboard:amd:b650", manufacturer: "MSI", brand: "MAG",
    aliases: ["MAG B650M MORTAR WIFI", "MSI MAG B650M MORTAR WIFI", "B650M 박격포 WIFI", "MSI B650M 박격포 WIFI"],
    spec: {
      official_model: "MAG B650M MORTAR WIFI", exact_model: "MAG B650M MORTAR WIFI",
      product_family: "MAG", platform_vendor: "AMD", socket: "AM5", chipset: "B650",
      form_factor: "Micro-ATX", memory_generation: "DDR5", wifi: true, wifi_variant: "WIFI",
      edition: "MORTAR WIFI", revision: null,
      official_source_urls: ["https://www.msi.com/Motherboard/MAG-B650M-MORTAR-WIFI/Specification"]
    }
  }),
  record({
    id: "motherboard:asrock:z370m-pro4",
    name: "ASRock Z370M Pro4",
    category: "MOTHERBOARD", group: "motherboard:intel:z370", manufacturer: "ASRock", brand: "Pro",
    aliases: ["ASRock Z370M Pro4", "Z370M Pro4"],
    spec: {
      official_model: "Z370M Pro4", exact_model: "Z370M Pro4",
      product_family: "Pro", platform_vendor: "Intel", socket: "LGA1151", chipset: "Z370",
      form_factor: "Micro-ATX", memory_generation: "DDR4", wifi: false, wifi_variant: "NONE",
      edition: "PRO4", revision: null,
      official_source_urls: ["https://www.asrock.com/mb/Intel/Z370M%20Pro4/"]
    }
  }),
  ...[
    { manufacturer: "MSI", model: "MAG B650 TOMAHAWK WIFI", family: "MAG", platform: "AMD", socket: "AM5", chipset: "B650", formFactor: "ATX", ddr: "DDR5", wifi: true, edition: "TOMAHAWK WIFI", aliases: ["B650 토마호크 WIFI", "B650 토마호크 와이파이"], sourceUrl: "https://www.msi.com/Motherboard/MAG-B650-TOMAHAWK-WIFI/Specification" },
    { manufacturer: "MSI", model: "PRO B760M-A WIFI DDR4", family: "PRO", platform: "Intel", socket: "LGA1700", chipset: "B760", formFactor: "Micro-ATX", ddr: "DDR4", wifi: true, edition: "A WIFI DDR4", sourceUrl: "https://www.msi.com/Motherboard/PRO-B760M-A-WIFI-DDR4/Specification" },
    { manufacturer: "ASRock", model: "B550M Steel Legend", family: "Steel Legend", platform: "AMD", socket: "AM4", chipset: "B550", formFactor: "Micro-ATX", ddr: "DDR4", edition: "STEEL LEGEND", aliases: ["B550M 스틸레전드", "B550M 스틸 레전드"], sourceUrl: "https://www.asrock.com/mb/AMD/B550M%20Steel%20Legend/index.asp" },
    { manufacturer: "ASUS", model: "ROG CROSSHAIR VIII IMPACT", family: "ROG Crosshair", platform: "AMD", socket: "AM4", chipset: "X570", formFactor: "Mini-DTX", ddr: "DDR4", wifi: true, edition: "VIII IMPACT", sourceUrl: "https://rog.asus.com/motherboards/rog-crosshair/rog-crosshair-viii-impact-model/" },
    { manufacturer: "ASUS", model: "TUF GAMING B850M-PLUS II", family: "TUF Gaming", platform: "AMD", socket: "AM5", chipset: "B850", formFactor: "Micro-ATX", ddr: "DDR5", edition: "PLUS II", sourceUrl: "https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b850m-plus-ii/" },
    { manufacturer: "ASUS", model: "PRIME H610M-E D4", family: "Prime", platform: "Intel", socket: "LGA1700", chipset: "H610", formFactor: "Micro-ATX", ddr: "DDR4", edition: "E D4", sourceUrl: "https://www.asus.com/motherboards-components/motherboards/prime/prime-h610m-e-d4/" },
    { manufacturer: "ASUS", model: "TUF Z370-PLUS GAMING", family: "TUF Gaming", platform: "Intel", socket: "LGA1151", chipset: "Z370", formFactor: "ATX", ddr: "DDR4", edition: "PLUS GAMING", sourceUrl: "https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-z370-plus-gaming/" },
    { manufacturer: "ASUS", model: "EX-H110M-V", family: "Expedition", platform: "Intel", socket: "LGA1151", chipset: "H110", formFactor: "Micro-ATX", ddr: "DDR4", edition: "V", sourceUrl: "https://www.asus.com/supportonly/ex-h110m-v/" },
    { manufacturer: "ASUS", model: "TUF GAMING B760M-PLUS WIFI", family: "TUF Gaming", platform: "Intel", socket: "LGA1700", chipset: "B760", formFactor: "Micro-ATX", ddr: "DDR5", wifi: true, edition: "PLUS WIFI", sourceUrl: "https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b760m-plus-wifi/" },
    { manufacturer: "ASUS", model: "TUF GAMING B760M-PLUS II", family: "TUF Gaming", platform: "Intel", socket: "LGA1700", chipset: "B760", formFactor: "Micro-ATX", ddr: "DDR5", edition: "PLUS II", sourceUrl: "https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b760m-plus-ii/" },
    { manufacturer: "ASUS", model: "H110I-PLUS", family: "ASUS", platform: "Intel", socket: "LGA1151", chipset: "H110", formFactor: "Mini-ITX", ddr: "DDR4", edition: "I PLUS", sourceUrl: "https://www.asus.com/supportonly/h110i-plus/" },
    { manufacturer: "MSI", model: "B450M-A PRO MAX", family: "PRO", platform: "AMD", socket: "AM4", chipset: "B450", formFactor: "Micro-ATX", ddr: "DDR4", edition: "MAX", sourceUrl: "https://www.msi.com/Motherboard/B450M-A-PRO-MAX" },
    { manufacturer: "MSI", model: "PRO B650M-P", family: "PRO", platform: "AMD", socket: "AM5", chipset: "B650", formFactor: "Micro-ATX", ddr: "DDR5", edition: "P", sourceUrl: "https://www.msi.com/Motherboard/PRO-B650M-P" },
    { manufacturer: "MSI", model: "PRO B550M-P GEN3", family: "PRO", platform: "AMD", socket: "AM4", chipset: "B550", formFactor: "Micro-ATX", ddr: "DDR4", edition: "GEN3", sourceUrl: "https://www.msi.com/Motherboard/PRO-B550M-P-GEN3" },
    { manufacturer: "MSI", model: "B450M MORTAR MAX", family: "MORTAR", platform: "AMD", socket: "AM4", chipset: "B450", formFactor: "Micro-ATX", ddr: "DDR4", edition: "MAX", sourceUrl: "https://www.msi.com/Motherboard/B450M-MORTAR-MAX" },
    { manufacturer: "GIGABYTE", model: "B550M AORUS ELITE", family: "AORUS", platform: "AMD", socket: "AM4", chipset: "B550", formFactor: "Micro-ATX", ddr: "DDR4", revision: "1.x", revisionRequired: true, verifiedRevisions: ["1.0", "1.1", "1.2", "1.3"], sourceUrl: "https://www.gigabyte.com/Motherboard/B550M-AORUS-ELITE-rev-13" },
    { manufacturer: "GIGABYTE", model: "X870 AORUS ELITE WIFI7 ICE", family: "AORUS", platform: "AMD", socket: "AM5", chipset: "X870", formFactor: "ATX", ddr: "DDR5", wifi: true, edition: "WIFI7 ICE", revision: "1.x", revisionRequired: true, verifiedRevisions: ["1.0", "1.1", "1.2"], sourceUrl: "https://www.gigabyte.com/Motherboard/X870-AORUS-ELITE-WIFI7-ICE-rev-12" },
    { manufacturer: "GIGABYTE", model: "B850M AORUS STEALTH ICE", family: "AORUS", platform: "AMD", socket: "AM5", chipset: "B850", formFactor: "Micro-ATX", ddr: "DDR5", wifi: true, edition: "STEALTH ICE", sourceUrl: "https://www.gigabyte.com/Motherboard/B850M-AORUS-STEALTH-ICE" },
    { manufacturer: "GIGABYTE", model: "B850M AORUS ELITE", family: "AORUS", platform: "AMD", socket: "AM5", chipset: "B850", formFactor: "Micro-ATX", ddr: "DDR5", edition: "ELITE", sourceUrl: "https://www.gigabyte.com/Motherboard/B850M-AORUS-ELITE" },
    { manufacturer: "GIGABYTE", model: "B450M DS3H", family: "Ultra Durable", platform: "AMD", socket: "AM4", chipset: "B450", formFactor: "Micro-ATX", ddr: "DDR4", revision: "1.x", revisionRequired: true, sourceUrl: "https://www.gigabyte.com/Motherboard/B450M-DS3H-rev-1x" },
    { manufacturer: "GIGABYTE", model: "A520M K V2", family: "Ultra Durable", platform: "AMD", socket: "AM4", chipset: "A520", formFactor: "Micro-ATX", ddr: "DDR4", edition: "V2", revision: "1.x", revisionRequired: true, verifiedRevisions: ["1.0", "1.1", "1.2"], sourceUrl: "https://www.gigabyte.com/Motherboard/A520M-K-V2-rev-12" },
    { manufacturer: "ASRock", model: "Z390 Steel Legend", family: "Steel Legend", platform: "Intel", socket: "LGA1151", chipset: "Z390", formFactor: "ATX", ddr: "DDR4", edition: "STEEL LEGEND", sourceUrl: "https://www.asrock.com/mb/Intel/Z390%20Steel%20Legend/index.asp" },
    { manufacturer: "ASRock", model: "B360M-HDV", family: "HDV", platform: "Intel", socket: "LGA1151", chipset: "B360", formFactor: "Micro-ATX", ddr: "DDR4", edition: "HDV", sourceUrl: "https://www.asrock.com/mb/Intel/B360M-HDV/index.asp" },
    { manufacturer: "ASRock", model: "B150M Pro4", family: "Pro", platform: "Intel", socket: "LGA1151", chipset: "B150", formFactor: "Micro-ATX", ddr: "DDR4", edition: "PRO4", sourceUrl: "https://www.asrock.com/mb/Intel/B150M%20Pro4/index.asp" },
    { manufacturer: "ASRock", model: "H110M-DGS", family: "DGS", platform: "Intel", socket: "LGA1151", chipset: "H110", formFactor: "Micro-ATX", ddr: "DDR4", edition: "DGS", sourceUrl: "https://www.asrock.com/mb/Intel/H110M-DGS/index.asp" },
    { manufacturer: "ASRock", model: "B360M Pro4", family: "Pro", platform: "Intel", socket: "LGA1151", chipset: "B360", formFactor: "Micro-ATX", ddr: "DDR4", edition: "PRO4", sourceUrl: "https://www.asrock.com/mb/Intel/B360M%20Pro4/index.asp" }
  ].map(verifiedMotherboard)
];

export const PC_PRODUCT_MASTER_V2 = deepFreeze([
  ...gpuRecords("NVIDIA", "GeForce", NVIDIA_GPU_FAMILIES),
  ...gpuRecords("AMD", "Radeon", AMD_GPU_FAMILIES),
  ...gpuRecords("Intel", "Arc", INTEL_GPU_FAMILIES),
  ...intelCpuRecords(),
  ...amdCpuRecords(),
  ...ramRecords(),
  ...MOTHERBOARD_PRODUCTS,
  ...capacityBucketRecords("SSD", PC_SSD_CAPACITY_BUCKETS_V3),
  ...capacityBucketRecords("HDD", PC_HDD_CAPACITY_BUCKETS_V3),
  ...wattsBucketRecords(),
  ...OTHER_CATEGORY_NODES
]);

const legacySuccessors = {};
function addLegacy(legacyId, ...successors) {
  legacySuccessors[legacyId] = Object.freeze([...new Set(successors)]);
}
const storageLegacyBuckets = {
  SSD: {
    "le-256-gb": "le-256-gb", "480-512-gb": "257-512-gb", "960-gb-1-tb": "513-gb-1-tb",
    "1-92-2-tb": "gt-1-tb-le-2-tb", "3-84-4-tb": "gt-2-tb-le-4-tb", "7-68-8-tb": "gt-4-tb-le-8-tb", "gt-8-tb": "gt-8-tb"
  },
  HDD: {
    "le-1-tb": "le-1-tb", "2-tb": "gt-1-tb-le-2-tb", "3-4-tb": "gt-2-tb-le-4-tb",
    "5-6-tb": "gt-4-tb-le-6-tb", "8-tb": "gt-6-tb-le-8-tb", "10-12-tb": "gt-8-tb-le-12-tb",
    "14-16-tb": "gt-12-tb-le-16-tb", "18-20-tb": "gt-16-tb-le-20-tb", "22-24-tb": "gt-20-tb-le-24-tb", "ge-26-tb": "gt-24-tb"
  }
};
for (const category of ["SSD", "HDD"]) {
  for (const manufacturer of categoryManufacturers(category).filter((value) => value !== PC_UNCLASSIFIED_MANUFACTURER_V3)) {
    for (const [legacyBucket, successorBucket] of Object.entries(storageLegacyBuckets[category])) {
      addLegacy(`${category.toLowerCase()}:${slug(manufacturer)}:capacity-bucket:${legacyBucket}`,
        `${category.toLowerCase()}:${slug(manufacturer)}:capacity-bucket:${successorBucket}`);
    }
  }
}
const psuSuccessorSuffixes = PC_PSU_WATTS_BUCKETS_V3.map(([bucket]) => slug(bucket));
for (const formFactor of ["atx", "sfx", "sfx-l"]) {
  addLegacy(`psu:facet:${formFactor}`,
    ...categoryManufacturers("PSU").flatMap((manufacturer) => psuSuccessorSuffixes
      .map((bucket) => `psu:${slug(manufacturer)}:watts-bucket:${bucket}`)));
}
for (const manufacturer of categoryManufacturers("PSU").filter((value) => value !== PC_UNCLASSIFIED_MANUFACTURER_V3)) {
  for (const formFactor of ["atx", "sfx", "sfx-l"]) {
    addLegacy(`psu:facet:${formFactor}:${slug(manufacturer)}`,
      ...psuSuccessorSuffixes.map((bucket) => `psu:${slug(manufacturer)}:watts-bucket:${bucket}`));
  }
}
for (const [legacyId, successor] of Object.entries({
  "ssd:samsung:990-pro-1tb": "ssd:samsung:capacity-bucket:513-gb-1-tb",
  "ssd:samsung:990-pro-2tb": "ssd:samsung:capacity-bucket:gt-1-tb-le-2-tb",
  "ssd:samsung:m2-sata-1tb": "ssd:samsung:capacity-bucket:513-gb-1-tb",
  "hdd:seagate:st16000dm001": "hdd:seagate:capacity-bucket:gt-12-tb-le-16-tb",
  "psu:micronics:classic-ii-500": "psu:micronics:watts-bucket:le-500",
  "psu:micronics:classic-ii-600": "psu:micronics:watts-bucket:501-650",
  "psu:fsp:hydro-pro-600": "psu:fsp:watts-bucket:501-650",
  "psu:micronics:classic-ii-700": "psu:micronics:watts-bucket:651-750",
  "psu:seasonic:focus-gold-gx-750": "psu:seasonic:watts-bucket:651-750",
  "psu:seasonic:vertex-gx-850": "psu:seasonic:watts-bucket:751-850",
  "psu:super-flower:leadex-iii-850": "psu:super-flower:watts-bucket:751-850",
  "psu:seasonic:focus-gold-gx-1000": "psu:seasonic:watts-bucket:851-1000",
  "psu:corsair:rm1000x": "psu:corsair:watts-bucket:851-1000"
})) addLegacy(legacyId, successor);

export const PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3 = deepFreeze(legacySuccessors);

const currentCanonicalIds = new Set(PC_PRODUCT_MASTER_V2.map((product) => product.id));
export function resolvePcCanonicalIdV3(value) {
  const requestedId = String(value || "").trim();
  if (currentCanonicalIds.has(requestedId)) {
    return { status: "current", requestedId, canonicalProductIds: [requestedId] };
  }
  const successors = PC_LEGACY_CANONICAL_ID_SUCCESSORS_V3[requestedId] || [];
  if (successors.length === 1) {
    return { status: "alias", requestedId, canonicalProductIds: [...successors] };
  }
  if (successors.length > 1) {
    return { status: "ambiguous", requestedId, canonicalProductIds: [...successors] };
  }
  return { status: "missing", requestedId, canonicalProductIds: [] };
}
