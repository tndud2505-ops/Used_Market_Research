import type { NormalizedItem } from "../../MCP/logic/types.js";

interface ModelBlacklistEntry {
  model_name: string;
  status: "normal" | "cautionary" | "blacklisted";
  confidence_penalty: number;
  reason?: string;
  affected_components?: string[];
}

type ItemForBlacklistCheck = Pick<NormalizedItem, "components">;

const DEFAULT_BLACKLIST: ModelBlacklistEntry[] = [
  {
    model_name: "NVIDIA RTX 2060",
    status: "cautionary",
    confidence_penalty: 0.15,
    reason: "Memory issues reported in some batches",
    affected_components: ["gpu"]
  },
  {
    model_name: "NVIDIA RTX 3050",
    status: "normal",
    confidence_penalty: 0,
    reason: "Generally reliable"
  },
  {
    model_name: "Cheap Generic PSU",
    status: "blacklisted",
    confidence_penalty: 0.8,
    reason: "High failure rate - avoid purchase",
    affected_components: ["psu"]
  }
];

export class ModelBlacklistManager {
  private blacklist: Map<string, ModelBlacklistEntry>;

  constructor(entries: ModelBlacklistEntry[] = DEFAULT_BLACKLIST) {
    this.blacklist = new Map();
    for (const entry of entries) {
      this.blacklist.set(entry.model_name.toLowerCase(), entry);
    }
  }

  getModelStatus(modelName: string): ModelBlacklistEntry | null {
    return this.blacklist.get(modelName.toLowerCase()) || null;
  }

  checkComponentModels(item: ItemForBlacklistCheck): {
    model_status: "normal" | "cautionary" | "blacklisted";
    confidence_penalty: number;
    flagged_components: Array<{ component: string; model: string; status: string }>;
  } {
    let worstStatus: "normal" | "cautionary" | "blacklisted" = "normal";
    let maxPenalty = 0;
    const flaggedComponents: Array<{ component: string; model: string; status: string }> = [];

    for (const component of item.components) {
      const entry = this.getModelStatus(component.canonical_name);

      if (entry && entry.status !== "normal") {
        flaggedComponents.push({
          component: component.component_type,
          model: component.canonical_name,
          status: entry.status
        });

        if (entry.status === "blacklisted") {
          worstStatus = "blacklisted";
        } else if (entry.status === "cautionary" && worstStatus !== "blacklisted") {
          worstStatus = "cautionary";
        }

        maxPenalty = Math.max(maxPenalty, entry.confidence_penalty);
      }
    }

    return {
      model_status: worstStatus,
      confidence_penalty: maxPenalty,
      flagged_components: flaggedComponents
    };
  }

  addEntry(entry: ModelBlacklistEntry): void {
    this.blacklist.set(entry.model_name.toLowerCase(), entry);
  }

  removeEntry(modelName: string): boolean {
    return this.blacklist.delete(modelName.toLowerCase());
  }

  getAllEntries(): ModelBlacklistEntry[] {
    return Array.from(this.blacklist.values());
  }

  exportAsJSON(): string {
    return JSON.stringify(Array.from(this.blacklist.values()), null, 2);
  }
}

export const globalBlacklistManager = new ModelBlacklistManager();
