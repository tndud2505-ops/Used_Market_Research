export interface AppConfig {
  provider: "mock" | "gemini";
  geminiModel: string;
  geminiApiBaseUrl: string;
  geminiApiVersion: string;
  geminiApiTimeoutMs: number;
  geminiApiRetryAttempts: number;
  geminiApiRetryBaseMs: number;
  outputPretty: boolean;
  port: number;
  allowMockFallback: boolean;
  cliTrace: boolean;
  cliTracePrompts: boolean;
  debugConsole: boolean;
  debugConsolePrompts: boolean;
  showBrowser: boolean;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  return {
    provider: (process.env.MODEL_PROVIDER === "mock" ? "mock" : "gemini"),
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    geminiApiBaseUrl: process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com",
    geminiApiVersion: process.env.GEMINI_API_VERSION || "v1beta",
    geminiApiTimeoutMs: parseNumber(process.env.GEMINI_API_TIMEOUT_MS, 60_000),
    geminiApiRetryAttempts: parseNumber(process.env.GEMINI_API_RETRY_ATTEMPTS, 3),
    geminiApiRetryBaseMs: parseNumber(process.env.GEMINI_API_RETRY_BASE_MS, 1_500),
    outputPretty: process.env.OUTPUT_PRETTY !== "false",
    port: Number(process.env.API_PORT || 8787),
    allowMockFallback: parseBoolean(process.env.ALLOW_MOCK_FALLBACK, true),
    cliTrace: parseBoolean(process.env.CLI_TRACE, false) || parseBoolean(process.env.DEBUG_CONSOLE, false),
    cliTracePrompts: parseBoolean(process.env.CLI_TRACE_PROMPTS, false) || parseBoolean(process.env.DEBUG_CONSOLE_PROMPTS, false),
    debugConsole: parseBoolean(process.env.DEBUG_CONSOLE, false) || parseBoolean(process.env.CLI_TRACE, false),
    debugConsolePrompts: parseBoolean(process.env.DEBUG_CONSOLE_PROMPTS, false) || parseBoolean(process.env.CLI_TRACE_PROMPTS, false),
    showBrowser: parseBoolean(process.env.SHOW_BROWSER, false)
  };
}
