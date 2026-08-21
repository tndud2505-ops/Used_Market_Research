import { COMPONENT_PATTERNS } from "../../market/logic/componentCatalog.js";

export interface JobPlan {
  name: string;
  cron_hint: string;
  purpose: string;
  module_chain: string[];
  keywords?: string[];
  component_type?: string;
}

function extractKeywordsByComponentType(componentType: string): string[] {
  return [...new Set(COMPONENT_PATTERNS
    .filter((pattern) => pattern.componentType === componentType)
    .map((pattern) => pattern.canonical))];
}

export function getDefaultJobPlans(): JobPlan[] {
  const gpuKeywords = extractKeywordsByComponentType("gpu");
  const cpuKeywords = extractKeywordsByComponentType("cpu");
  const ramKeywords = extractKeywordsByComponentType("ram");
  const ssdKeywords = extractKeywordsByComponentType("ssd");
  const psuKeywords = extractKeywordsByComponentType("psu");

  return [
    {
      name: "gpu-fast-scan",
      cron_hint: "every 2 hours",
      purpose: "Scan fast-moving GPU listings using catalog-derived keywords",
      module_chain: ["MCP", "collector", "market", "merge"],
      keywords: gpuKeywords,
      component_type: "gpu"
    },
    {
      name: "cpu-scan",
      cron_hint: "every 2 hours",
      purpose: "Scan CPU listings using catalog-derived keywords",
      module_chain: ["MCP", "collector", "market", "merge"],
      keywords: cpuKeywords,
      component_type: "cpu"
    },
    {
      name: "ram-scan",
      cron_hint: "every 2 hours",
      purpose: "Scan RAM listings using catalog-derived keywords",
      module_chain: ["MCP", "collector", "market", "merge"],
      keywords: ramKeywords,
      component_type: "ram"
    },
    {
      name: "ssd-scan",
      cron_hint: "every 2 hours",
      purpose: "Scan SSD listings using catalog-derived keywords",
      module_chain: ["MCP", "collector", "market", "merge"],
      keywords: ssdKeywords,
      component_type: "ssd"
    },
    {
      name: "psu-scan",
      cron_hint: "every 2 hours",
      purpose: "Scan PSU listings using catalog-derived keywords",
      module_chain: ["MCP", "collector", "market", "merge"],
      keywords: psuKeywords,
      component_type: "psu"
    },
    {
      name: "full-pc-scan",
      cron_hint: "every 2 hours",
      purpose: "Scan completed and assembled PC listings",
      module_chain: ["MCP", "collector", "market", "merge"],
      keywords: ["본체", "컴퓨터", "PC", "데스크탑", "조립PC"]
    },
    {
      name: "daily-price-refresh",
      cron_hint: "every day 03:00 Asia/Seoul",
      purpose: "Refresh price windows from the latest saved merge results",
      module_chain: ["scheduler", "market", "merge"],
      keywords: ["daily-price-refresh"]
    }
  ];
}
