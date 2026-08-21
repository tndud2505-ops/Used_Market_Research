import { z } from "zod";
import { loadConfig } from "./config.js";
import { parseLooseJson } from "./json.js";
import {
  isPromptTraceEnabled,
  summarizeText,
  trace,
  traceError
} from "./runtime-trace.js";
import type { ModelProvider, ModelRequest, ProviderCheckResult, ProviderMetadata } from "./types.js";

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
}

interface GeminiRequestError extends Error {
  status?: number;
  retryable?: boolean;
}

function resolveAuthMode(): string {
  if (process.env.GEMINI_API_KEY) return "gemini_api_key";
  if (process.env.GOOGLE_API_KEY) return "google_api_key";
  return "missing_api_key";
}

function resolveApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

function buildApiUrl(modelName: string) {
  const config = loadConfig();
  const baseUrl = trimTrailingSlash(config.geminiApiBaseUrl);
  const apiKey = resolveApiKey();
  const version = config.geminiApiVersion.replace(/^\/+|\/+$/g, "");
  const encodedModel = encodeURIComponent(modelName);
  return `${baseUrl}/${version}/models/${encodedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function buildPrompt(request: ModelRequest) {
  return [
    request.prompt,
    "",
    "Return only a valid JSON object that satisfies the requested schema.",
    "Do not wrap the JSON in markdown fences."
  ].join("\n");
}

function extractText(response: GeminiGenerateContentResponse) {
  const text = response.candidates?.[0]?.content?.parts
    ?.map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (text) return text;

  if (response.promptFeedback?.blockReason) {
    throw new Error(`Gemini API blocked the prompt: ${response.promptFeedback.blockReason}`);
  }

  const finishReason = response.candidates?.[0]?.finishReason;
  throw new Error(`Gemini API returned no text candidate${finishReason ? ` (finish_reason=${finishReason})` : ""}`);
}

function createRequestError(message: string, options?: { status?: number; retryable?: boolean; cause?: unknown }) {
  const error = new Error(message) as GeminiRequestError;
  error.status = options?.status;
  error.retryable = options?.retryable;
  if (options?.cause !== undefined) {
    Object.defineProperty(error, "cause", {
      configurable: true,
      enumerable: false,
      value: options.cause,
      writable: true
    });
  }
  return error;
}

function isRetryableStatus(status?: number) {
  return status !== undefined && [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiApiProvider implements ModelProvider {
  readonly name = "gemini-api";

  getMetadata(): ProviderMetadata {
    const config = loadConfig();
    return {
      provider_name: this.name,
      model_name: config.geminiModel,
      auth_mode: resolveAuthMode()
    };
  }

  providerCheck(): ProviderCheckResult {
    const config = loadConfig();
    const apiKey = resolveApiKey();
    const endpoint = apiKey ? buildApiUrl(config.geminiModel).replace(/key=[^&]+/, "key=***") : null;

    if (!apiKey) {
      return {
        ...this.getMetadata(),
        ready: false,
        command: null,
        checked_at: new Date().toISOString(),
        notes: ["Set GEMINI_API_KEY or GOOGLE_API_KEY to enable Gemini API requests."]
      };
    }

    return {
      ...this.getMetadata(),
      ready: true,
      command: endpoint,
      checked_at: new Date().toISOString(),
      notes: [`Gemini API is configured for model ${config.geminiModel}.`]
    };
  }

  async runJson<T>(request: ModelRequest, schema: z.ZodType<T>): Promise<T> {
    const config = loadConfig();
    const apiKey = resolveApiKey();
    if (!apiKey) {
      throw new Error("AUTHENTICATION_ERROR: GEMINI_API_KEY or GOOGLE_API_KEY is required.");
    }

    const prompt = buildPrompt(request);
    const url = buildApiUrl(config.geminiModel);
    trace("gemini-api.runJson:start", {
      model: config.geminiModel,
      timeout_ms: request.timeoutMs ?? config.geminiApiTimeoutMs,
      url: url.replace(/key=[^&]+/, "key=***"),
      prompt_preview: isPromptTraceEnabled() ? summarizeText(prompt, 500) : undefined
    });

    try {
      const response = await this.generateContent(prompt, request);
      const text = extractText(response);
      trace("gemini-api.runJson:complete", {
        model: config.geminiModel,
        response_preview: summarizeText(text, 240)
      });
      return schema.parse(parseLooseJson(text));
    } catch (error) {
      traceError("gemini-api.runJson:failed", error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`INTERNAL_ERROR: ${message}`);
    }
  }

  private async generateContent(prompt: string, request: ModelRequest): Promise<GeminiGenerateContentResponse> {
    const config = loadConfig();
    const timeoutMs = request.timeoutMs ?? config.geminiApiTimeoutMs;
    const maxAttempts = Math.max(1, config.geminiApiRetryAttempts);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        trace("gemini-api.request:attempt", {
          attempt,
          max_attempts: maxAttempts,
          timeout_ms: timeoutMs
        });
        return await this.sendGenerateContentRequest(prompt, request, timeoutMs);
      } catch (error) {
        lastError = error;
        const retryable = error instanceof Error && (error as GeminiRequestError).retryable === true;
        const status = error instanceof Error ? (error as GeminiRequestError).status : undefined;

        traceError("gemini-api.request:attempt-failed", error);
        if (!retryable || attempt === maxAttempts) {
          break;
        }

        const delayMs = config.geminiApiRetryBaseMs * Math.pow(2, attempt - 1);
        trace("gemini-api.request:retrying", { attempt, next_delay_ms: delayMs, status });
        await sleep(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Gemini API request failed: ${String(lastError ?? "unknown error")}`);
  }

  private async sendGenerateContentRequest(
    prompt: string,
    request: ModelRequest,
    timeoutMs: number
  ): Promise<GeminiGenerateContentResponse> {
    const config = loadConfig();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(buildApiUrl(config.geminiModel), {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: request.systemPrompt
            ? {
                parts: [{ text: request.systemPrompt }]
              }
            : undefined,
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const raw = await response.text();
        const detail = summarizeText(raw, 500);
        throw createRequestError(
          `Gemini API request failed with status ${response.status}: ${detail}`,
          { status: response.status, retryable: isRetryableStatus(response.status) }
        );
      }

      return await response.json() as GeminiGenerateContentResponse;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw createRequestError(`Gemini API request timed out after ${timeoutMs}ms`, {
          status: 408,
          retryable: true,
          cause: error
        });
      }

      if (error instanceof Error) {
        if ((error as GeminiRequestError).status !== undefined) {
          throw error;
        }

        throw createRequestError(`Gemini API network failure: ${error.message}`, {
          retryable: true,
          cause: error
        });
      }

      throw createRequestError(`Gemini API request failed: ${String(error)}`, {
        retryable: true,
        cause: error
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
