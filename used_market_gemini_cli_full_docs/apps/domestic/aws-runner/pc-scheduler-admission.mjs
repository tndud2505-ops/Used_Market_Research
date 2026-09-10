export function schedulerReadDeferral({
  nowMs = Date.now(),
  lastPublicReadAtMs = 0,
  deferralStartedAtMs = 0,
  recentReadWindowMs = 5_000,
  maximumDeferralMs = 10 * 60 * 1_000,
} = {}) {
  const now = Number(nowMs);
  const lastRead = Number(lastPublicReadAtMs);
  const recentWindow = Math.max(0, Number(recentReadWindowMs) || 0);
  const maximumDeferral = Math.max(recentWindow, Number(maximumDeferralMs) || 0);
  const readIsRecent = Number.isFinite(now) && Number.isFinite(lastRead)
    && lastRead > 0 && now - lastRead >= 0 && now - lastRead < recentWindow;
  if (!readIsRecent) return { defer: false, nextDeferralStartedAtMs: 0 };
  const existingStart = Number(deferralStartedAtMs);
  const startedAt = Number.isFinite(existingStart) && existingStart > 0 ? existingStart : now;
  if (now - startedAt >= maximumDeferral) return { defer: false, nextDeferralStartedAtMs: 0 };
  return { defer: true, nextDeferralStartedAtMs: startedAt };
}
