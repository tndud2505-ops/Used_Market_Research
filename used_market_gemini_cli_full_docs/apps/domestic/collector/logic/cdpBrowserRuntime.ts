import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

type WebSocketEventLike = {
  data?: unknown;
};

type WebSocketLike = {
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: unknown) => void): void;
  close(): void;
  send(data: string): void;
};

type RemoteTarget = {
  id?: string;
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type CdpCommandResponse = {
  id: number;
  result?: unknown;
  error?: {
    message?: string;
  };
};

type PendingCommand = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

function browserCommandTimeoutMs(): number {
  const configured = Number(process.env.LOCAL_BROWSER_COMMAND_TIMEOUT_MS ?? "15000");
  return Number.isFinite(configured) && configured >= 1_000 && configured <= 60_000
    ? Math.trunc(configured)
    : 15_000;
}

function getWebSocketCtor(): (new (url: string) => WebSocketLike) | null {
  const candidate = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  return typeof candidate === "function" ? candidate : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reserveDebugPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve a debugging port."));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function normalizeMessageData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  if (data && typeof data === "object" && "text" in data && typeof (data as { text: () => Promise<string> }).text === "function") {
    throw new Error("Blob websocket payloads are not supported in this runtime.");
  }
  return String(data ?? "");
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Remote debugging endpoint failed with status ${response.status}.`);
  }
  return await response.json() as T;
}

function resolveBrowserBinary(): string | null {
  const configured = process.env.LOCAL_BROWSER_BINARY?.trim();
  if (configured) {
    return configured;
  }

  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome"
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function waitForPageTarget(port: number, timeoutMs = 15_000): Promise<RemoteTarget> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const targets = await readJson<RemoteTarget[]>(`http://127.0.0.1:${port}/json/list`);
      const pageTarget = targets.find((target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string");
      if (pageTarget) {
        return pageTarget;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await delay(200);
  }

  throw new Error(lastError?.message ?? "Browser debugging endpoint did not expose a page target.");
}

function ensureStringResult(value: unknown, context: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`${context} did not return a string result.`);
}

export class LocalCdpBrowserRuntime {
  private browserProcess: ChildProcess | null = null;
  private webSocket: WebSocketLike | null = null;
  private readonly pending = new Map<number, PendingCommand>();
  private nextCommandId = 1;
  private tempUserDataDir: string | null = null;
  private currentUrlValue = "about:blank";
  private debugPort: number | null = null;

  constructor(
    private readonly browserBinary: string,
    private readonly headless = false
  ) {}

  static create(options: { headless?: boolean } = {}): LocalCdpBrowserRuntime | null {
    const browserBinary = resolveBrowserBinary();
    const unavailableReason = LocalCdpBrowserRuntime.describeUnavailableReason(browserBinary);
    if (unavailableReason || !browserBinary) {
      return null;
    }

    return new LocalCdpBrowserRuntime(browserBinary, options.headless ?? false);
  }

  static describeUnavailableReason(browserBinary = resolveBrowserBinary()): string | null {
    if (process.env.DISABLE_LOCAL_BROWSER_RUNTIME === "true") {
      return "visible browser runtime disabled by DISABLE_LOCAL_BROWSER_RUNTIME=true";
    }

    if (!getWebSocketCtor()) {
      return "global WebSocket runtime is not available for local browser automation";
    }

    if (!browserBinary) {
      return "no local Chrome/Edge binary was detected for visible browser automation";
    }

    return null;
  }

  async goto(url: string): Promise<{ html: string; url: string }> {
    await this.ensureStarted();
    await this.sendCommand("Page.navigate", { url });
    await this.waitForReadyState();
    return await this.snapshot();
  }

  async snapshot(): Promise<{ html: string; url: string }> {
    await this.ensureStarted();
    const snapshot = await this.evaluateObject<{ html?: unknown; url?: unknown }>(
      "({ html: document.documentElement ? document.documentElement.outerHTML : '', url: location.href })"
    );
    const html = ensureStringResult(snapshot.html, "document HTML snapshot");
    const currentUrl = ensureStringResult(snapshot.url, "document URL snapshot");
    this.currentUrlValue = currentUrl;
    return {
      html,
      url: currentUrl
    };
  }

  async currentUrl(): Promise<string> {
    return this.currentUrlValue;
  }

  async close(): Promise<void> {
    try {
      this.webSocket?.close();
    } catch {
      // Ignore websocket close failures during cleanup.
    }
    this.webSocket = null;

    if (this.browserProcess) {
      try {
        this.browserProcess.kill();
      } catch {
        // Ignore process teardown failures during cleanup.
      }
      this.browserProcess = null;
    }

    if (this.tempUserDataDir) {
      await rm(this.tempUserDataDir, { recursive: true, force: true }).catch(() => undefined);
      this.tempUserDataDir = null;
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.webSocket) {
      return;
    }

    this.debugPort = await reserveDebugPort();
    this.tempUserDataDir = await mkdtemp(path.join(os.tmpdir(), "used-market-edge-"));
    this.browserProcess = spawn(this.browserBinary, [
      `--remote-debugging-port=${this.debugPort}`,
      `--user-data-dir=${this.tempUserDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-dev-shm-usage",
      ...(process.env.LOCAL_BROWSER_NO_SANDBOX === "true" ? ["--no-sandbox"] : []),
      ...(this.headless ? ["--headless=new"] : []),
      "about:blank"
    ], {
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(this.tempUserDataDir, "xdg-config"),
        XDG_DATA_HOME: path.join(this.tempUserDataDir, "xdg-data")
      },
      stdio: "ignore",
      windowsHide: this.headless
    });

    const target = await waitForPageTarget(this.debugPort);
    if (!target.webSocketDebuggerUrl) {
      throw new Error("Browser page target did not expose a websocket debugger URL.");
    }

    this.webSocket = await this.connect(target.webSocketDebuggerUrl);
    await this.sendCommand("Page.enable");
    await this.sendCommand("Runtime.enable");
  }

  private async connect(webSocketUrl: string): Promise<WebSocketLike> {
    const WebSocketCtor = getWebSocketCtor();
    if (!WebSocketCtor) {
      throw new Error("global WebSocket runtime is not available for local browser automation");
    }

    const socket = new WebSocketCtor(webSocketUrl);
    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => resolve();
      const handleError = (event: unknown) => reject(new Error(`Browser websocket failed to open: ${String(event)}`));

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
    });

    socket.addEventListener("message", (event: unknown) => {
      const data = normalizeMessageData((event as WebSocketEventLike).data);
      if (!data) {
        return;
      }

      const payload = JSON.parse(data) as Partial<CdpCommandResponse> & { method?: string };
      if (typeof payload.id === "number") {
        const pending = this.pending.get(payload.id);
        if (!pending) {
          return;
        }
        this.pending.delete(payload.id);
        clearTimeout(pending.timer);
        if (payload.error?.message) {
          pending.reject(new Error(payload.error.message));
          return;
        }
        pending.resolve(payload.result);
      }
    });

    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Browser websocket closed before the command completed."));
      }
      this.pending.clear();
    });

    return socket;
  }

  private async sendCommand<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.webSocket) {
      throw new Error("Browser websocket is not connected.");
    }

    const id = this.nextCommandId;
    this.nextCommandId += 1;

    const payload = JSON.stringify({
      id,
      method,
      params
    });

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new Error(`Browser command ${method} timed out after ${browserCommandTimeoutMs()}ms.`));
      }, browserCommandTimeoutMs());
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });

      try {
        this.webSocket?.send(payload);
      } catch (error) {
        const pending = this.pending.get(id);
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async waitForReadyState(timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const readyState = await this.evaluateValue("document.readyState");
      if (readyState === "complete" || readyState === "interactive") {
        return;
      }
      await delay(150);
    }

    throw new Error(`Browser page did not reach a ready state within ${timeoutMs}ms.`);
  }

  private async evaluateValue(expression: string): Promise<unknown> {
    const response = await this.sendCommand<{
      result?: {
        value?: unknown;
      };
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });

    return response.result?.value;
  }

  private async evaluateObject<T>(expression: string): Promise<T> {
    return await this.evaluateValue(expression) as T;
  }
}
