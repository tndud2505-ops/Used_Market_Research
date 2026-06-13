import { collectLoginCheck, collectSearchListings } from "../../collector/logic/browserCollector.js";
import { enrichBuildListingDetails } from "../../collector/logic/buildDetailEnricher.js";
import { normalizeRawResult } from "../../collector/logic/normalize-raw.js";
import { buildMessageDraftPrompt, buildValidationPrompt, COMMON_RULES } from "../../collector/logic/prompts.js";
import { resolveSite } from "../../collector/logic/sites.js";
import { normalizeSearchResult } from "../../market/logic/normalize.js";
import { annotateNormalizedResultNoise } from "../../market/logic/noise-filter.js";
import { mergeNormalizedResults } from "../../market/logic/opportunity.js";
import { buildMarketSnapshot } from "../../market/logic/pricing.js";
import { persistMarketWorkflowResult } from "../../market/logic/result-persistence.js";
import { getDefaultJobPlans } from "../../scheduler/logic/jobs.js";
import { loadConfig } from "./config.js";
import { trace } from "./runtime-trace.js";
import { validateKeyword, validateLimit, validateSearchInput, validateSite, validateSites } from "./validation.js";
import {
  LoginCheckResultSchema,
  MergeResultSchema,
  MessageDraftSchema,
  ValidationResultSchema,
  type FullWorkflowInput,
  type ModelProvider,
  type LoginCheckResult,
  type SearchResult
} from "./types.js";
import { SearchResultSchema } from "./types.js";

type BrowserCommandOptions = {
  showBrowser?: boolean;
};

export class Orchestrator {
  private readonly config = loadConfig();

  constructor(private readonly provider: ModelProvider) {
  }

  private resolveShowBrowser(options?: BrowserCommandOptions) {
    return options?.showBrowser ?? this.config.showBrowser;
  }

  async loginCheck(siteKey: string, options?: BrowserCommandOptions) {
    validateSite(siteKey);
    const showBrowser = this.resolveShowBrowser(options);
    trace("orchestrator.loginCheck:start", { site: siteKey, show_browser: showBrowser });
    const result = LoginCheckResultSchema.parse(await collectLoginCheck(siteKey, { showBrowser }));
    trace("orchestrator.loginCheck:complete", {
      site: siteKey,
      show_browser: showBrowser,
      login_status: result.login_status,
      current_page: result.current_page
    });
    return result;
  }

  async search(input: { site: string; keyword: string; limit: number }, options?: BrowserCommandOptions) {
    validateSearchInput(input);
    const showBrowser = this.resolveShowBrowser(options);
    trace("orchestrator.search:start", { ...input, show_browser: showBrowser });
    const result = normalizeRawResult(SearchResultSchema.parse(await collectSearchListings(input, { showBrowser })));
    trace("orchestrator.search:complete", {
      site: input.site,
      keyword: input.keyword,
      show_browser: showBrowser,
      item_count: result.items.length,
      warning_count: result.warnings.length,
      error_count: result.errors.length
    });
    return result;
  }

  async normalize(siteKey: string, _keyword: string, searchResult: SearchResult) {
    validateSite(siteKey);
    resolveSite(siteKey);
    trace("orchestrator.normalize:start", {
      site: siteKey,
      incoming_items: searchResult.items.length
    });
    const detailEnrichment = await enrichBuildListingDetails(siteKey, searchResult);
    const result = annotateNormalizedResultNoise(normalizeSearchResult(searchResult, {
      detailByUrl: detailEnrichment.detailByUrl,
      additionalWarnings: detailEnrichment.warnings
    }));
    trace("orchestrator.normalize:complete", {
      site: siteKey,
      normalized_items: result.normalized_items.length,
      warning_count: result.warnings.length,
      detail_attempted: detailEnrichment.attempted,
      detail_succeeded: detailEnrichment.succeeded
    });
    return result;
  }

  async buildMessageDraft(input: { site: string; title: string; price: number | null; seller: string; url: string }) {
    validateSite(input.site);
    const site = resolveSite(input.site);
    return this.provider.runJson(
      {
        systemPrompt: COMMON_RULES,
        prompt: buildMessageDraftPrompt({
          siteName: site.name,
          title: input.title,
          price: input.price,
          seller: input.seller,
          url: input.url
        })
      },
      MessageDraftSchema
    );
  }

  async validateSelection(input: { site: string; title: string; price: number | null; seller: string; url: string }) {
    validateSite(input.site);
    const site = resolveSite(input.site);
    return this.provider.runJson(
      {
        systemPrompt: COMMON_RULES,
        prompt: buildValidationPrompt({
          siteName: site.name,
          title: input.title,
          price: input.price,
          seller: input.seller,
          url: input.url
        })
      },
      ValidationResultSchema
    );
  }

  schedulePlan() {
    trace("orchestrator.schedulePlan");
    return { jobs: getDefaultJobPlans() };
  }

  async fullWorkflow(input: FullWorkflowInput, options?: BrowserCommandOptions) {
    validateKeyword(input.keyword);
    validateSites(input.sites);
    validateLimit(input.limit);
    const showBrowser = this.resolveShowBrowser(options);

    if (input.goodPriceInput) {
      validateSite(input.goodPriceInput.site);
    }

    const searchResults = [] as SearchResult[];
    const normalizedResults = [] as Array<ReturnType<typeof normalizeSearchResult>>;
    const loginResults = [] as Array<LoginCheckResult>;
    trace("orchestrator.fullWorkflow:start", {
      keyword: input.keyword,
      sites: input.sites,
      limit: input.limit,
      include_good_price_input: Boolean(input.goodPriceInput),
      show_browser: showBrowser
    });

    for (const siteKey of input.sites) {
      trace("orchestrator.fullWorkflow:site:start", { site: siteKey, keyword: input.keyword, show_browser: showBrowser });
      const site = resolveSite(siteKey);
      const login = LoginCheckResultSchema.parse(await this.loginCheck(siteKey, { showBrowser }));
      loginResults.push(login);
      if (site.loginRequired && login.login_status === "logged_out") {
        trace("orchestrator.fullWorkflow:site:skip", { site: siteKey, reason: "logged_out" });
        continue;
      }

      const search = await this.search({ site: siteKey, keyword: input.keyword, limit: input.limit }, { showBrowser });
      searchResults.push(search);
      normalizedResults.push(await this.normalize(siteKey, input.keyword, search));
      trace("orchestrator.fullWorkflow:site:complete", {
        site: siteKey,
        search_items: search.items.length,
        show_browser: showBrowser
      });
    }

    const merged = MergeResultSchema.parse(mergeNormalizedResults(input.keyword, normalizedResults));
    const snapshot = buildMarketSnapshot(input.keyword, merged);
    trace("orchestrator.fullWorkflow:merge-complete", {
      merged_items: merged.merged_items.length,
      snapshot_windows: snapshot.windows.length
    });

    const response: Record<string, unknown> = {
      keyword: input.keyword,
      login_results: loginResults,
      search_results: searchResults,
      normalized_results: normalizedResults,
      merged_result: merged,
      market_snapshot: snapshot,
      schedule_hint: getDefaultJobPlans()
    };

    if (input.persistMarketResult !== false) {
      const stored = await persistMarketWorkflowResult({
        keyword: input.keyword,
        normalizedResults: normalizedResults,
        mergedResult: merged,
        marketSnapshot: snapshot
      });

      response.market_result_ref = {
        module: "market",
        command: "full-workflow",
        run_id: stored.runId,
        base_dir: stored.baseDir
      };
      trace("orchestrator.fullWorkflow:persisted", response.market_result_ref);
    }

    if (input.goodPriceInput) {
      response.message_draft = await this.buildMessageDraft(input.goodPriceInput);
      response.validation = await this.validateSelection(input.goodPriceInput);
    }

    trace("orchestrator.fullWorkflow:complete", {
      keyword: input.keyword,
      login_sites: loginResults.length,
      searched_sites: searchResults.length
    });
    return response;
  }
}
