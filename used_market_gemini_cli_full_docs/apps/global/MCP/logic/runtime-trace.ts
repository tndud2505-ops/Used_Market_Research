import process from "node:process";

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function readFlag(name: string, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function formatDetails(details?: unknown) {
  if (details === undefined) return "";
  if (typeof details === "string") return ` ${details}`;

  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return ` ${String(details)}`;
  }
}

export function isTraceEnabled() {
  return readFlag("CLI_TRACE", false) || readFlag("DEBUG_CONSOLE", false);
}

export function isPromptTraceEnabled() {
  return readFlag("CLI_TRACE_PROMPTS", false) || readFlag("DEBUG_CONSOLE_PROMPTS", false);
}

function extractModuleLabel(message: string) {
  const prefix = message.split(/[.:]/, 1)[0]?.trim().toLowerCase() || "runtime";
  if (prefix === "cli") return "MCP";
  return prefix;
}

export function summarizeText(text: string, maxLength = 280) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function trace(message: string, details?: unknown) {
  if (!isTraceEnabled()) return;
  const moduleLabel = extractModuleLabel(message);
  process.stderr.write(`[debug ${new Date().toISOString()}][${moduleLabel}] ${message}${formatDetails(details)}\n`);
}

export function traceError(message: string, error: unknown) {
  const detail = error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { error: String(error) };
  trace(message, detail);
}

export function applyCliRuntimeFlags(argv: string[]) {
  const sanitized = argv.slice(0, 2);

  for (const arg of argv.slice(2)) {
    if (arg === "--trace") {
      process.env.CLI_TRACE = "true";
      process.env.DEBUG_CONSOLE = "true";
      continue;
    }

    if (arg === "--trace-prompts") {
      process.env.CLI_TRACE = "true";
      process.env.CLI_TRACE_PROMPTS = "true";
      process.env.DEBUG_CONSOLE = "true";
      process.env.DEBUG_CONSOLE_PROMPTS = "true";
      continue;
    }

    if (arg === "--debug-console") {
      process.env.DEBUG_CONSOLE = "true";
      continue;
    }

    if (arg === "--debug-prompts") {
      process.env.DEBUG_CONSOLE = "true";
      process.env.DEBUG_CONSOLE_PROMPTS = "true";
      continue;
    }

    sanitized.push(arg);
  }

  return sanitized;
}

export function createPrefixedLineWriter(prefix: string) {
  let buffer = "";

  return {
    write(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break;

        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        process.stderr.write(`${prefix}${line}\n`);
      }
    },
    flush() {
      if (!buffer) return;
      process.stderr.write(`${prefix}${buffer}\n`);
      buffer = "";
    }
  };
}
