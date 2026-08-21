import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { MergedItem } from "../../MCP/logic/types.js";

const AlertChannelSchema = z.enum(["webhook", "discord", "email"]);

const AlertRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean().default(true),
  category: z.enum(["full_pc", "gpu", "parts", "all"]).default("all"),
  min_net_profit: z.number().default(100_000),
  max_fraud_risk: z.number().min(0).max(1).default(0.2),
  allowed_model_statuses: z.array(z.enum(["normal", "cautionary", "blacklisted"])).default(["normal"]),
  channels: z.array(AlertChannelSchema).min(1),
  notes: z.string().default("")
});

const AlertRulesFileSchema = z.object({
  rules: z.array(AlertRuleSchema).default([])
});

export type AlertChannel = z.infer<typeof AlertChannelSchema>;
export type AlertRule = z.infer<typeof AlertRuleSchema>;
export type AlertRulesFile = z.infer<typeof AlertRulesFileSchema>;

export interface AlertMatch {
  rule_id: string;
  rule_name: string;
  channels: AlertChannel[];
  category: AlertRule["category"];
  item_title: string;
  item_url: string;
  net_profit: number;
  fraud_risk_score: number;
}

function inferCategory(item: MergedItem): AlertRule["category"] {
  if (item.listing_type === "full_pc" || item.listing_type === "semi_pc") return "full_pc";
  if (item.components.some((component) => component.component_type === "gpu")) return "gpu";
  return "parts";
}

async function readAlertRulesFile(): Promise<AlertRulesFile> {
  const filePath = process.env.SCHEDULER_ALERT_RULES_FILE
    ? path.resolve(process.env.SCHEDULER_ALERT_RULES_FILE)
    : path.resolve(process.cwd(), "scheduler/alert-rules.json");

  try {
    const raw = await readFile(filePath, "utf-8");
    return AlertRulesFileSchema.parse(JSON.parse(raw));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return { rules: [] };
    }
    throw error;
  }
}

function matchesRule(rule: AlertRule, item: MergedItem): boolean {
  const category = inferCategory(item);
  const netProfit = item.net_profit ?? Number.NEGATIVE_INFINITY;

  if (!rule.enabled) return false;
  if (rule.category !== "all" && rule.category !== category) return false;
  if (netProfit < rule.min_net_profit) return false;
  if (item.fraud_risk_score > rule.max_fraud_risk) return false;
  if (!rule.allowed_model_statuses.includes(item.model_status)) return false;
  return true;
}

export async function loadAlertRules(): Promise<AlertRule[]> {
  const file = await readAlertRulesFile();
  return file.rules;
}

export async function evaluateAlertRules(items: MergedItem[]): Promise<AlertMatch[]> {
  const rules = await loadAlertRules();
  const matches: AlertMatch[] = [];

  for (const item of items) {
    for (const rule of rules) {
      if (!matchesRule(rule, item)) continue;
      matches.push({
        rule_id: rule.id,
        rule_name: rule.name,
        channels: rule.channels,
        category: inferCategory(item),
        item_title: item.title,
        item_url: item.url,
        net_profit: item.net_profit ?? 0,
        fraud_risk_score: item.fraud_risk_score
      });
    }
  }

  return matches;
}
