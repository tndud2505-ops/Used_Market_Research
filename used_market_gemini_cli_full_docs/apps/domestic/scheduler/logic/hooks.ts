import type { AlertChannel, AlertMatch } from "./alert-rules.js";

export interface SchedulerAlertDispatchSummary {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  reasons: string[];
}

function formatCurrency(value: number) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(value))} KRW`;
}

function resolveWebhookUrl(channel: AlertChannel) {
  if (channel === "discord") {
    return process.env.SCHEDULER_ALERT_DISCORD_WEBHOOK_URL
      ?? process.env.SCHEDULER_ALERT_WEBHOOK_URL
      ?? "";
  }

  if (channel === "webhook") {
    return process.env.SCHEDULER_ALERT_WEBHOOK_URL
      ?? process.env.SCHEDULER_ALERT_DISCORD_WEBHOOK_URL
      ?? "";
  }

  if (channel === "email") {
    return process.env.SCHEDULER_ALERT_EMAIL_WEBHOOK_URL ?? "";
  }

  return "";
}

function buildAlertBody(
  channel: AlertChannel,
  jobName: string,
  runId: string,
  match: AlertMatch
) {
  const text = [
    `[${match.rule_name}] ${match.item_title}`,
    `job: ${jobName}`,
    `profit: ${formatCurrency(match.net_profit)}`,
    `fraud: ${(match.fraud_risk_score * 100).toFixed(1)}%`,
    `url: ${match.item_url}`
  ].join("\n");

  if (channel === "discord") {
    return {
      content: text.slice(0, 1800)
    };
  }

  return {
    run_id: runId,
    job_name: jobName,
    rule_id: match.rule_id,
    rule_name: match.rule_name,
    category: match.category,
    item_title: match.item_title,
    item_url: match.item_url,
    net_profit: match.net_profit,
    fraud_risk_score: match.fraud_risk_score,
    text
  };
}

export async function dispatchSchedulerAlertMatches(
  jobName: string,
  runId: string,
  matches: AlertMatch[]
): Promise<SchedulerAlertDispatchSummary> {
  if (matches.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      reasons: []
    };
  }

  const summary: SchedulerAlertDispatchSummary = {
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    reasons: []
  };
  const seen = new Set<string>();

  for (const match of matches) {
    for (const channel of match.channels) {
      const dedupeKey = `${match.rule_id}|${match.item_url}|${channel}`;
      if (seen.has(dedupeKey)) {
        summary.skipped += 1;
        continue;
      }
      seen.add(dedupeKey);

      const webhookUrl = resolveWebhookUrl(channel);
      if (!webhookUrl) {
        summary.skipped += 1;
        summary.reasons.push(`missing_webhook:${channel}`);
        continue;
      }

      summary.attempted += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);

      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(buildAlertBody(channel, jobName, runId, match)),
          signal: controller.signal
        });

        if (!response.ok) {
          summary.failed += 1;
          summary.reasons.push(`webhook_http_${response.status}:${channel}`);
          continue;
        }

        summary.sent += 1;
      } catch (error) {
        summary.failed += 1;
        summary.reasons.push(
          error instanceof Error ? `${channel}:${error.message}` : `${channel}:${String(error)}`
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  return summary;
}

export function getHookDrafts() {
  return [
    { name: "after-collector", action: "write central result" },
    { name: "after-market", action: "refresh latest merged candidates" },
    { name: "after-merge", action: "dispatch scheduler alerts to webhook/discord" }
  ];
}
