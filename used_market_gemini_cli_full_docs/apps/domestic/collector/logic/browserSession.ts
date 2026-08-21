import { LocalCdpBrowserRuntime } from "./cdpBrowserRuntime.js";

export type BrowserMode = "headless" | "headful";

export type BrowserFailureKind =
  | "runtime_unavailable"
  | "selector_drift"
  | "blocked_page"
  | "empty_results"
  | "unsupported_evidence_shape"
  | "site_not_supported";

export interface BrowserSessionInfo {
  mode: BrowserMode;
  showBrowser: boolean;
  available: boolean;
  unavailableReason: string | null;
}

export interface BrowserNodeRef {
  readonly selector: string;
  text(selector?: string): Promise<string>;
  attr(selector: string, name: string): Promise<string | null>;
  attrSelf(name: string): Promise<string | null>;
  exists(selector: string): Promise<boolean>;
  html(selector?: string): Promise<string>;
  queryAll(selector: string): Promise<BrowserNodeRef[]>;
}

export interface BrowserSession extends BrowserSessionInfo {
  goto(url: string): Promise<void>;
  currentUrl(): Promise<string>;
  waitForIdle(readinessSelector?: string): Promise<void>;
  exists(selector: string): Promise<boolean>;
  text(selector: string): Promise<string>;
  attr(selector: string, name: string): Promise<string | null>;
  html(selector?: string): Promise<string>;
  json(selector?: string): Promise<unknown>;
  queryAll(selector: string): Promise<BrowserNodeRef[]>;
  close(): Promise<void>;
  describe(): BrowserSessionInfo;
}

export class BrowserRuntimeUnavailableError extends Error {
  readonly code = "BROWSER_RUNTIME_UNAVAILABLE";

  constructor(message = "browser runtime is not wired in this workspace") {
    super(message);
    this.name = "BrowserRuntimeUnavailableError";
  }
}

function throwUnavailable(reason: string | null): never {
  throw new BrowserRuntimeUnavailableError(reason ?? "browser runtime is not wired in this workspace");
}

type HtmlNode = HtmlElementNode | HtmlTextNode;

interface HtmlElementNode {
  kind: "element";
  tagName: string;
  attributes: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlElementNode | null;
}

interface HtmlTextNode {
  kind: "text";
  value: string;
  parent: HtmlElementNode | null;
}

interface HtmlSelectorCondition {
  name: string;
  operator: "exists" | "=" | "*=" | "^=" | "$=";
  value: string;
}

interface HtmlSimpleSelector {
  tag: string | null;
  classes: string[];
  attrs: HtmlSelectorCondition[];
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeWhitespace(input: string): string {
  return decodeEntities(input).replace(/\s+/g, " ").trim();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createElementNode(tagName: string, parent: HtmlElementNode | null): HtmlElementNode {
  return {
    kind: "element",
    tagName,
    attributes: {},
    children: [],
    parent
  };
}

function parseAttributes(input: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(input)) !== null) {
    const name = match[1].toLowerCase();
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    attributes[name] = value;
  }

  return attributes;
}

function parseHtml(html: string): HtmlElementNode {
  const root = createElementNode("#document", null);
  const stack: HtmlElementNode[] = [root];
  const tokenPattern = /<!--[\s\S]*?-->|<!DOCTYPE[\s\S]*?>|<\/?[A-Za-z][^>]*>|[^<]+/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(html)) !== null) {
    const token = match[0];
    const parent = stack[stack.length - 1];

    if (token.startsWith("<!--") || token.startsWith("<!DOCTYPE")) {
      continue;
    }

    if (token.startsWith("</")) {
      const closingTag = token.slice(2, -1).trim().toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].tagName === closingTag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }

    if (token.startsWith("<")) {
      const selfClosing = token.endsWith("/>");
      const inner = token.slice(1, token.length - (selfClosing ? 2 : 1)).trim();
      if (inner.length === 0) {
        continue;
      }

      const firstSpace = inner.search(/\s/);
      const tagName = (firstSpace === -1 ? inner : inner.slice(0, firstSpace)).toLowerCase();
      const attributeSource = firstSpace === -1 ? "" : inner.slice(firstSpace + 1);
      const node = createElementNode(tagName, parent);
      node.attributes = parseAttributes(attributeSource);
      parent.children.push(node);

      if (!selfClosing && !VOID_TAGS.has(tagName)) {
        stack.push(node);
      }
      continue;
    }

    const textValue = token;
    if (textValue.trim() === "") {
      continue;
    }
    parent.children.push({
      kind: "text",
      value: textValue,
      parent
    });
  }

  return root;
}

function serializeNode(node: HtmlNode): string {
  if (node.kind === "text") {
    return escapeHtml(node.value);
  }

  if (node.tagName === "#document") {
    return node.children.map((child) => serializeNode(child)).join("");
  }

  const attributes = Object.entries(node.attributes)
    .map(([key, value]) => (value === "" ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`))
    .join("");
  const children = node.children.map((child) => serializeNode(child)).join("");
  if (VOID_TAGS.has(node.tagName)) {
    return `<${node.tagName}${attributes}>`;
  }
  return `<${node.tagName}${attributes}>${children}</${node.tagName}>`;
}

function collectText(node: HtmlNode): string {
  if (node.kind === "text") {
    return decodeEntities(node.value);
  }
  return node.children.map((child) => collectText(child)).join(" ");
}

function splitSelectorGroups(selector: string): string[] {
  const groups: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let bracketDepth = 0;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];

    if (quote) {
      current += char;
      if (char === quote && selector[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      current += char;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }

    if (char === "," && bracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        groups.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    groups.push(trimmed);
  }

  return groups;
}

function splitSelectorChain(selector: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let bracketDepth = 0;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];

    if (quote) {
      current += char;
      if (char === quote && selector[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      current += char;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }

    if (/\s/.test(char) && bracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        tokens.push(trimmed);
        current = "";
      }
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    tokens.push(trimmed);
  }

  return tokens;
}

function parseSimpleSelector(selector: string): HtmlSimpleSelector {
  let index = 0;
  let tag: string | null = null;
  const classes: string[] = [];
  const attrs: HtmlSelectorCondition[] = [];

  const tagMatch = selector.match(/^[A-Za-z][A-Za-z0-9_-]*/);
  if (tagMatch) {
    tag = tagMatch[0].toLowerCase();
    index = tag.length;
  }

  while (index < selector.length) {
    const char = selector[index];

    if (char === ".") {
      index += 1;
      const start = index;
      while (index < selector.length && ![".", "[", "#"].includes(selector[index])) {
        index += 1;
      }
      const className = selector.slice(start, index).trim();
      if (className.length > 0) {
        classes.push(className);
      }
      continue;
    }

    if (char === "[") {
      let depth = 1;
      let end = index + 1;
      let quote: "'" | '"' | null = null;
      while (end < selector.length && depth > 0) {
        const current = selector[end];
        if (quote) {
          if (current === quote && selector[end - 1] !== "\\") {
            quote = null;
          }
        } else if (current === "'" || current === '"') {
          quote = current;
        } else if (current === "[") {
          depth += 1;
        } else if (current === "]") {
          depth -= 1;
        }
        end += 1;
      }

      const content = selector.slice(index + 1, end - 1).trim();
      const attrMatch = content.match(/^([^\s~|^$*!=]+)\s*(\*=|\^=|\$=|=)?\s*(.*)$/);
      if (attrMatch) {
        const name = attrMatch[1].toLowerCase();
        const operator = (attrMatch[2] ?? "exists") as HtmlSelectorCondition["operator"];
        let value = (attrMatch[3] ?? "").trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        attrs.push({
          name,
          operator,
          value: decodeEntities(value)
        });
      }
      index = end;
      continue;
    }

    if (char === "#") {
      index += 1;
      while (index < selector.length && ![".", "[", "#"].includes(selector[index])) {
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return { tag, classes, attrs };
}

function nodeClassList(node: HtmlElementNode): Set<string> {
  return new Set((node.attributes.class ?? "").split(/\s+/).filter(Boolean));
}

function matchesSimpleSelector(node: HtmlElementNode, selector: HtmlSimpleSelector): boolean {
  if (selector.tag && node.tagName !== selector.tag) {
    return false;
  }

  const classList = nodeClassList(node);
  for (const className of selector.classes) {
    if (!classList.has(className)) {
      return false;
    }
  }

  for (const condition of selector.attrs) {
    const value = node.attributes[condition.name];
    if (condition.operator === "exists") {
      if (value === undefined) {
        return false;
      }
      continue;
    }

    if (value === undefined) {
      return false;
    }

    if (condition.operator === "=" && value !== condition.value) {
      return false;
    }
    if (condition.operator === "*=" && !value.includes(condition.value)) {
      return false;
    }
    if (condition.operator === "^=" && !value.startsWith(condition.value)) {
      return false;
    }
    if (condition.operator === "$=" && !value.endsWith(condition.value)) {
      return false;
    }
  }

  return true;
}

function walkDescendants(node: HtmlElementNode, visitor: (candidate: HtmlElementNode) => void): void {
  for (const child of node.children) {
    if (child.kind === "element") {
      visitor(child);
      walkDescendants(child, visitor);
    }
  }
}

function querySelectorAllFromNode(baseNode: HtmlElementNode, selector: string): HtmlElementNode[] {
  const results: HtmlElementNode[] = [];
  const seen = new Set<HtmlElementNode>();

  for (const group of splitSelectorGroups(selector)) {
    const chain = splitSelectorChain(group).map((token) => parseSimpleSelector(token));
    if (chain.length === 0) {
      continue;
    }

    let currentCandidates: HtmlElementNode[] = [baseNode];

    for (const simpleSelector of chain) {
      const nextCandidates: HtmlElementNode[] = [];
      for (const candidate of currentCandidates) {
        walkDescendants(candidate, (descendant) => {
          if (matchesSimpleSelector(descendant, simpleSelector)) {
            nextCandidates.push(descendant);
          }
        });
      }
      currentCandidates = nextCandidates;
      if (currentCandidates.length === 0) {
        break;
      }
    }

    for (const node of currentCandidates) {
      if (!seen.has(node)) {
        seen.add(node);
        results.push(node);
      }
    }
  }

  return results;
}

function firstMatch(baseNode: HtmlElementNode, selector: string): HtmlElementNode | null {
  return querySelectorAllFromNode(baseNode, selector)[0] ?? null;
}

function extractJsonFromText(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  return JSON.parse(trimmed);
}

class ParsedBrowserNodeRef implements BrowserNodeRef {
  constructor(public readonly selector: string, private readonly node: HtmlElementNode) {}

  async text(selector?: string): Promise<string> {
    if (!selector) {
      return normalizeWhitespace(collectText(this.node));
    }
    const match = firstMatch(this.node, selector);
    return match ? normalizeWhitespace(collectText(match)) : "";
  }

  async attr(selector: string, name: string): Promise<string | null> {
    const match = firstMatch(this.node, selector);
    if (!match) {
      return null;
    }
    return match.attributes[name.toLowerCase()] ?? null;
  }

  async attrSelf(name: string): Promise<string | null> {
    return this.node.attributes[name.toLowerCase()] ?? null;
  }

  async exists(selector: string): Promise<boolean> {
    return firstMatch(this.node, selector) !== null;
  }

  async html(selector?: string): Promise<string> {
    if (!selector) {
      return serializeNode(this.node);
    }
    const match = firstMatch(this.node, selector);
    return match ? serializeNode(match) : "";
  }

  async queryAll(selector: string): Promise<BrowserNodeRef[]> {
    return querySelectorAllFromNode(this.node, selector).map((node) => new ParsedBrowserNodeRef(selector, node));
  }
}

class FetchBrowserSession implements BrowserSession {
  readonly mode: BrowserMode;
  readonly available = true;
  readonly unavailableReason: string | null = null;
  private document: HtmlElementNode | null = null;
  private htmlSource = "";
  private currentUrlValue = "about:blank";

  constructor(
    readonly showBrowser: boolean,
    initialSnapshot?: { html: string; url: string }
  ) {
    this.mode = showBrowser ? "headful" : "headless";
    if (initialSnapshot) {
      this.loadSnapshot(initialSnapshot.html, initialSnapshot.url);
    }
  }

  private loadSnapshot(html: string, url: string): void {
    this.currentUrlValue = url;
    this.htmlSource = html;
    this.document = parseHtml(html);
  }

  async currentUrl(): Promise<string> {
    return this.currentUrlValue;
  }

  async goto(url: string): Promise<void> {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });
      this.loadSnapshot(await response.text(), response.url || url);
    } catch (error) {
      throw new BrowserRuntimeUnavailableError(
        `fetch navigation failed for ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async waitForIdle(_readinessSelector?: string): Promise<void> {
    return;
  }

  async exists(selector: string): Promise<boolean> {
    return this.document ? firstMatch(this.document, selector) !== null : false;
  }

  async text(selector?: string): Promise<string> {
    if (!this.document) {
      return "";
    }
    if (!selector) {
      return normalizeWhitespace(collectText(this.document));
    }
    const match = firstMatch(this.document, selector);
    return match ? normalizeWhitespace(collectText(match)) : "";
  }

  async attr(selector: string, name: string): Promise<string | null> {
    if (!this.document) {
      return null;
    }
    const match = firstMatch(this.document, selector);
    if (!match) {
      return null;
    }
    return match.attributes[name.toLowerCase()] ?? null;
  }

  async html(selector?: string): Promise<string> {
    if (!this.document) {
      return "";
    }
    if (!selector) {
      return serializeNode(this.document);
    }
    const match = firstMatch(this.document, selector);
    return match ? serializeNode(match) : "";
  }

  async json(selector?: string): Promise<unknown> {
    if (!this.document) {
      return null;
    }
    if (selector) {
      const match = firstMatch(this.document, selector);
      if (!match) {
        return null;
      }
      const text = normalizeWhitespace(collectText(match));
      if (text === "") {
        return null;
      }
      return extractJsonFromText(text);
    }

    const rawSource = this.htmlSource.trim();
    if (rawSource.startsWith("{") || rawSource.startsWith("[")) {
      return extractJsonFromText(rawSource);
    }
    const text = normalizeWhitespace(collectText(this.document));
    if (text.startsWith("{") || text.startsWith("[")) {
      return extractJsonFromText(text);
    }
    return null;
  }

  async queryAll(selector: string): Promise<BrowserNodeRef[]> {
    if (!this.document) {
      return [];
    }
    return querySelectorAllFromNode(this.document, selector).map((node) => new ParsedBrowserNodeRef(selector, node));
  }

  async close(): Promise<void> {
    this.document = null;
    this.htmlSource = "";
    this.currentUrlValue = "about:blank";
  }

  describe(): BrowserSessionInfo {
    return {
      mode: this.mode,
      showBrowser: this.showBrowser,
      available: this.available,
      unavailableReason: this.unavailableReason
    };
  }
}

class LocalBrowserSession implements BrowserSession {
  readonly mode: BrowserMode;
  readonly available = true;
  readonly unavailableReason: string | null = null;
  private document: HtmlElementNode | null = null;
  private htmlSource = "";
  private currentUrlValue = "about:blank";

  constructor(readonly showBrowser: boolean, private readonly runtime: LocalCdpBrowserRuntime) {
    this.mode = showBrowser ? "headful" : "headless";
  }

  async currentUrl(): Promise<string> {
    return this.currentUrlValue;
  }

  async goto(url: string): Promise<void> {
    try {
      const snapshot = await this.runtime.goto(url);
      this.currentUrlValue = snapshot.url || url;
      this.htmlSource = snapshot.html;
      this.document = parseHtml(this.htmlSource);
    } catch (error) {
      throw new BrowserRuntimeUnavailableError(
        `visible browser navigation failed for ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async waitForIdle(readinessSelector?: string): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const snapshot = await this.runtime.snapshot();
      this.currentUrlValue = snapshot.url || this.currentUrlValue;
      this.htmlSource = snapshot.html;
      this.document = parseHtml(this.htmlSource);
      if (
        (readinessSelector && firstMatch(this.document, readinessSelector))
        || (!readinessSelector && /\/products\/|data-role=["'][^"']*(product|listing)/i.test(this.htmlSource))
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async exists(selector: string): Promise<boolean> {
    return this.document ? firstMatch(this.document, selector) !== null : false;
  }

  async text(selector?: string): Promise<string> {
    if (!this.document) {
      return "";
    }
    if (!selector) {
      return normalizeWhitespace(collectText(this.document));
    }
    const match = firstMatch(this.document, selector);
    return match ? normalizeWhitespace(collectText(match)) : "";
  }

  async attr(selector: string, name: string): Promise<string | null> {
    if (!this.document) {
      return null;
    }
    const match = firstMatch(this.document, selector);
    if (!match) {
      return null;
    }
    return match.attributes[name.toLowerCase()] ?? null;
  }

  async html(selector?: string): Promise<string> {
    if (!this.document) {
      return "";
    }
    if (!selector) {
      return serializeNode(this.document);
    }
    const match = firstMatch(this.document, selector);
    return match ? serializeNode(match) : "";
  }

  async json(selector?: string): Promise<unknown> {
    if (!this.document) {
      return null;
    }
    if (selector) {
      const match = firstMatch(this.document, selector);
      if (!match) {
        return null;
      }
      const text = normalizeWhitespace(collectText(match));
      if (text === "") {
        return null;
      }
      return extractJsonFromText(text);
    }

    const rawSource = this.htmlSource.trim();
    if (rawSource.startsWith("{") || rawSource.startsWith("[")) {
      return extractJsonFromText(rawSource);
    }
    const text = normalizeWhitespace(collectText(this.document));
    if (text.startsWith("{") || text.startsWith("[")) {
      return extractJsonFromText(text);
    }
    return null;
  }

  async queryAll(selector: string): Promise<BrowserNodeRef[]> {
    if (!this.document) {
      return [];
    }
    return querySelectorAllFromNode(this.document, selector).map((node) => new ParsedBrowserNodeRef(selector, node));
  }

  async close(): Promise<void> {
    this.document = null;
    this.htmlSource = "";
    this.currentUrlValue = "about:blank";
    await this.runtime.close();
  }

  describe(): BrowserSessionInfo {
    return {
      mode: this.mode,
      showBrowser: this.showBrowser,
      available: this.available,
      unavailableReason: this.unavailableReason
    };
  }
}

class UnavailableBrowserSession implements BrowserSession {
  readonly mode: BrowserMode;
  readonly available = false;
  readonly unavailableReason: string;

  constructor(readonly showBrowser: boolean, reason?: string) {
    this.mode = "headless";
    this.unavailableReason = reason ?? "browser runtime is not wired in this workspace";
  }

  async goto(_url: string): Promise<void> {
    throwUnavailable(this.unavailableReason);
  }

  async currentUrl(): Promise<string> {
    throwUnavailable(this.unavailableReason);
  }

  async waitForIdle(_readinessSelector?: string): Promise<void> {
    throwUnavailable(this.unavailableReason);
  }

  async exists(_selector: string): Promise<boolean> {
    throwUnavailable(this.unavailableReason);
  }

  async text(_selector: string): Promise<string> {
    throwUnavailable(this.unavailableReason);
  }

  async attr(_selector: string, _name: string): Promise<string | null> {
    throwUnavailable(this.unavailableReason);
  }

  async html(_selector?: string): Promise<string> {
    throwUnavailable(this.unavailableReason);
  }

  async json(_selector?: string): Promise<unknown> {
    throwUnavailable(this.unavailableReason);
  }

  async queryAll(_selector: string): Promise<BrowserNodeRef[]> {
    throwUnavailable(this.unavailableReason);
  }

  async close(): Promise<void> {
    return;
  }

  describe(): BrowserSessionInfo {
    return {
      mode: this.mode,
      showBrowser: this.showBrowser,
      available: this.available,
      unavailableReason: this.unavailableReason
    };
  }
}

export function createBrowserSession(options: { showBrowser?: boolean; headless?: boolean } = {}): BrowserSession {
  if (options.showBrowser) {
    const runtime = LocalCdpBrowserRuntime.create({ headless: false });
    if (runtime) {
      return new LocalBrowserSession(true, runtime);
    }

    const reason = LocalCdpBrowserRuntime.describeUnavailableReason()
      ?? "visible browser runtime is not available in this workspace";
    return new UnavailableBrowserSession(true, reason);
  }

  if (options.headless) {
    const runtime = LocalCdpBrowserRuntime.create({ headless: true });
    if (runtime) {
      return new LocalBrowserSession(false, runtime);
    }

    const reason = LocalCdpBrowserRuntime.describeUnavailableReason()
      ?? "headless browser runtime is not available in this workspace";
    return new UnavailableBrowserSession(false, reason);
  }

  if (typeof fetch !== "function") {
    return new UnavailableBrowserSession(Boolean(options.showBrowser));
  }

  return new FetchBrowserSession(Boolean(options.showBrowser));
}

export function createBrowserFixtureSession(html: string, url: string): BrowserSession {
  return new FetchBrowserSession(false, { html, url });
}
