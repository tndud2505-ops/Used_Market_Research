import { LoginCheckResultSchema, SearchResultSchema, type ModelProvider, type SearchCommandInput } from "../../MCP/logic/types.js";
import {
  ValidationError,
  buildCollectorValidationFailure,
  validateSearchInput,
  validateSite
} from "../../MCP/logic/validation.js";
import { collectLoginCheck, collectSearchListings } from "./browserCollector.js";
import { normalizeRawResult } from "./normalize-raw.js";
import { resolveSite } from "./sites.js";
import { isPromptTraceEnabled, summarizeText, trace } from "../../MCP/logic/runtime-trace.js";

export class CollectorEngine {
  constructor(private readonly provider: ModelProvider) {}

  async loginCheck(siteKey: string) {
    validateSite(siteKey);
    const site = resolveSite(siteKey);
    trace("collector.loginCheck:browser", {
      site: site.key,
      provider: this.provider.name,
      browser_mode: "browser-first",
      prompt_preview: isPromptTraceEnabled() ? summarizeText(site.name, 220) : undefined
    });
    const result = await collectLoginCheck(site.key);
    return LoginCheckResultSchema.parse(result);
  }

  async search(input: SearchCommandInput) {
    try {
      validateSearchInput(input);
    } catch (error) {
      if (error instanceof ValidationError) {
        return SearchResultSchema.parse(buildCollectorValidationFailure(input, error));
      }
      throw error;
    }

    const site = resolveSite(input.site);
    trace("collector.search:browser", {
      site: site.key,
      provider: this.provider.name,
      keyword: input.keyword,
      limit: input.limit,
      browser_mode: "browser-first",
      prompt_preview: isPromptTraceEnabled() ? summarizeText(`${site.name} ${input.keyword}`, 260) : undefined
    });
    const result = await collectSearchListings(input);
    return normalizeRawResult(SearchResultSchema.parse(result));
  }
}
