import type { NormalizedItem } from "../../MCP/logic/types.js";

type ItemForBottleneckCheck = Pick<NormalizedItem, "listing_type" | "components">;

function getPerformanceLevel(componentName: string): "entry" | "mid" | "high" | "extreme" {
  const lowerName = componentName.toLowerCase();

  if (lowerName.includes("4090") || lowerName.includes("4080")) return "extreme";
  if (lowerName.includes("4070") || lowerName.includes("4060")) return "high";
  if (lowerName.includes("3090") || lowerName.includes("3080")) return "high";
  if (lowerName.includes("3070") || lowerName.includes("3060")) return "mid";
  if (lowerName.includes("3050") || lowerName.includes("2060")) return "entry";

  if (lowerName.includes("i9") || lowerName.includes("ryzen9")) return "extreme";
  if (lowerName.includes("i7") || lowerName.includes("ryzen7")) return "high";
  if (lowerName.includes("i5") || lowerName.includes("ryzen5")) return "mid";
  if (lowerName.includes("i3") || lowerName.includes("ryzen3")) return "entry";

  return "mid";
}

export function analyzeBottlenecks(item: ItemForBottleneckCheck): {
  bottleneck_issues: string[];
  price_impact: number;
} {
  const issues: string[] = [];
  let priceImpact = 0;

  const cpuComponent = item.components.find((component) => component.component_type === "cpu");
  const gpuComponent = item.components.find((component) => component.component_type === "gpu");
  const ramComponent = item.components.find((component) => component.component_type === "ram");
  const ssdComponent = item.components.find((component) => component.component_type === "ssd");
  const hddComponent = item.components.find((component) => component.component_type === "hdd");

  if (item.listing_type !== "full_pc" && item.listing_type !== "semi_pc") {
    return {
      bottleneck_issues: issues,
      price_impact: priceImpact
    };
  }

  if (gpuComponent && cpuComponent) {
    const gpuLevel = getPerformanceLevel(gpuComponent.canonical_name);
    const cpuLevel = getPerformanceLevel(cpuComponent.canonical_name);
    const gpuLevelIndex = { entry: 0, mid: 1, high: 2, extreme: 3 }[gpuLevel];
    const cpuLevelIndex = { entry: 0, mid: 1, high: 2, extreme: 3 }[cpuLevel];

    if (gpuLevelIndex - cpuLevelIndex > 1) {
      issues.push(
        `GPU-CPU bottleneck: ${gpuComponent.canonical_name} (GPU: ${gpuLevel}) vs ${cpuComponent.canonical_name} (CPU: ${cpuLevel})`
      );
      priceImpact -= 50000;
    }
  }

  if (ramComponent) {
    const ramSizeText = ramComponent.canonical_name.match(/(\d+)GB/i)?.[1];
    if (ramSizeText) {
      const ramSize = parseInt(ramSizeText, 10);
      if (ramSize <= 8) {
        issues.push(`Insufficient RAM: ${ramSize}GB (performance bottleneck)`);
        priceImpact -= 30000;
      }
    }
  }

  if (!ssdComponent && hddComponent) {
    issues.push("No SSD detected - HDD only (significant performance impact)");
    priceImpact -= 100000;
  }

  if (ssdComponent) {
    const ssdSizeText = ssdComponent.canonical_name.match(/(\d+)GB/i)?.[1];
    if (ssdSizeText) {
      const ssdSize = parseInt(ssdSizeText, 10);
      if (ssdSize <= 256) {
        issues.push(`Low capacity SSD: ${ssdSize}GB (frequent usage constraints)`);
        priceImpact -= 20000;
      }
    }
  }

  return {
    bottleneck_issues: issues,
    price_impact: priceImpact
  };
}
