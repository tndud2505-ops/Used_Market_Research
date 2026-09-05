import { createHash } from "node:crypto";
import { classifyPcPartListing, classifyPcPartListingPublic, detectPcPartManufacturer } from "../market/logic/pc-parts-classifier.mjs";
import { explicitSoldText } from "../market/logic/listing-lifecycle.mjs";
import { PC_PRODUCT_MASTER_V2, PC_PRODUCT_MASTER_V2_VERSION } from "../market/data/pc-product-master-v2.mjs";
import { PC_SOURCE_REGISTRY, getPcSource } from "../collector/logic/pc-source-registry.mjs";
import { trustedSpecialistCategory } from "../collector/logic/pc-specialist-targets.mjs";

const VERSIONS = Object.freeze({ parserVersion: "pc-parser-v1", ruleVersion: "pc-rules-v1", filterVersion: "pc-filter-v1" });

function sourceListingId(item) {
  const explicit = String(item.source_listing_id || "").trim();
  if (explicit) return explicit;
  const identifier = String(item.item_id || item.id || "").trim();
  const prefix = `${String(item.site || "").trim()}:`;
  return identifier.startsWith(prefix) ? identifier.slice(prefix.length) : identifier || String(item.url || "").trim();
}

function lifecycle(item) {
  const supplied = item.lifecycle_status ?? item.status;
  const raw = String(supplied || "").trim().toUpperCase();
  if (["ACTIVE", "RESERVED", "DELETED", "EXPIRED", "UNAVAILABLE_UNKNOWN", "BLOCKED_OR_PRIVATE"].includes(raw)) {
    return { status: raw, evidence: { type: "STRUCTURED_STATUS", value: raw } };
  }
  if (raw === "SOLD") return { status: "SOLD", evidence: { type: "STRUCTURED_STATUS", value: "SOLD" } };
  const lifecycleText = `${item.title || ""} ${item.description || ""}`;
  const explicit = explicitSoldText(lifecycleText);
  if (explicit) return { status: "SOLD", evidence: { type: "EXPLICIT_TEXT", value: explicit } };
  return { status: "ACTIVE", evidence: { type: "INFERRED_DEFAULT", value: "ACTIVE" } };
}

function fingerprint(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized ? createHash("sha256").update(normalized).digest("hex") : "";
}

function duplicateIdentity(item) {
  const text = `${item.title || ""} ${item.description || ""}`;
  const serial = text.match(/(?:s\/n|serial|시리얼)\s*[:#-]?\s*([a-z0-9-]{6,})/iu)?.[1] || "";
  const signals = [
    ["seller_fingerprint", item.seller_ref || item.seller_name],
    ["serial_number", serial],
    ["image_hash", item.image_hash]
  ].map(([key, value]) => [key, fingerprint(value)]).filter(([, value]) => value);
  if (signals.length < 2) return null;
  return {
    clusterKey: `pcdup:${fingerprint(signals.map(([key, value]) => `${key}:${value}`).sort().join("|"))}`,
    evidence: { identity_keys: signals.map(([key]) => key), fingerprints: Object.fromEntries(signals) }
  };
}

function comparablePrices(price, quantity, priceScope) {
  if (!Number.isFinite(price) || price <= 0) return { unitPrice: null, totalPrice: null };
  const count = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  if (priceScope === "UNIT") return { unitPrice: price, totalPrice: price * count };
  return { unitPrice: count > 1 ? Number((price / count).toFixed(2)) : price, totalPrice: price };
}

function cpuModelToken(value) {
  const matches = [...String(value || "").normalize("NFKC").toUpperCase()
    .matchAll(/(\d{3,5}(?:X3D|KF|KS|XT|K|F|G|X)?)/gu)]
    .map((match) => match[1]);
  return matches.at(-1) || "";
}

function cpuProductMatchesClassification(classified, product) {
  if (classified?.category_code !== "CPU" || !classified?.canonical_model || !product?.spec?.cpu_model) return true;
  const classifiedModel = cpuModelToken(classified.canonical_model);
  const productModel = cpuModelToken(product.spec.cpu_model);
  return !classifiedModel || !productModel || classifiedModel === productModel;
}

function componentItemsWithExplicitPrices(value, components) {
  const text = String(value || "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/gu, "");
  const positioned = components.map((component) => ({ component, position: text.indexOf(component.alias_text) }))
    .filter((entry) => entry.position >= 0)
    .sort((left, right) => left.position - right.position);
  return positioned.map((entry, index) => {
    const start = entry.position + entry.component.alias_text.length;
    const end = positioned[index + 1]?.position ?? text.length;
    const segment = text.slice(start, end);
    const manwon = segment.match(/^.{0,16}?(\d{1,4})만원/u);
    const won = segment.match(/^.{0,16}?(\d{4,9})원/u);
    const priceMatch = manwon || won;
    const bundleMarkerIndex = segment.search(/(?:세트|묶음|일괄|총액|합계|반본체)/u);
    const priceTokenIndex = segment.search(/\d{1,9}(?:만원|원)/u);
    const priceIsBundleTotal = priceMatch && bundleMarkerIndex >= 0 && bundleMarkerIndex < priceTokenIndex;
    const explicitPrice = priceIsBundleTotal ? null : manwon ? Number(manwon[1]) * 10_000 : won ? Number(won[1]) : null;
    return {
      canonicalProductId: entry.component.canonical_product_id,
      quantity: 1,
      unitPrice: explicitPrice,
      totalPrice: explicitPrice,
      spec: entry.component.spec || {}
    };
  });
}

function unknownModelCandidate(value) {
  const stopWords = new Set([
    "정상", "작동", "정상작동", "판매", "팝니다", "급처", "미개봉", "제품", "컴퓨터",
    "부품", "문의", "개인", "사용", "택포", "직거래", "택배", "완료", "예약"
  ]);
  const text = String(value || "").normalize("NFKC")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ")
    .replace(/(?<!\d)(?:\+?82[- .]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/gu, " ");
  const tokens = text.match(/[a-z0-9가-힣-]{3,30}/giu) || [];
  return tokens.find((token) => {
    const normalized = token.toLowerCase();
    if (stopWords.has(normalized)) return false;
    return /[a-z가-힣]/iu.test(normalized) && (/[0-9]/u.test(normalized) || /^[가-힣]{4,12}$/u.test(normalized));
  }) || null;
}

function storageCapacityGb(value) {
  const matches = [...String(value || "").matchAll(/\b(\d+(?:\.\d+)?)\s*(TB|GB)\b/giu)]
    .map((match) => Number(match[1]) * (match[2].toUpperCase() === "TB" ? 1000 : 1))
    .filter((capacity) => Number.isFinite(capacity) && capacity > 0);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}

function directoryFacetProduct(classified, value) {
  const category = classified.category_code;
  const manufacturer = classified.manufacturer;
  if (!manufacturer || !category) return null;
  const text = String(value || "").normalize("NFKC");
  const candidates = PC_PRODUCT_MASTER_V2.filter((product) => product.category === category && product.manufacturer === manufacturer);
  let matches = [];
  if (category === "RAM") {
    const generation = text.match(/\bDDR([345])\b/iu)?.[0]?.toUpperCase();
    const capacity = Number(classified.module_capacity_gb);
    matches = candidates.filter((product) => product.spec?.memory_generation === generation && Number(product.spec?.module_capacity_gb) === capacity);
  } else if (category === "SSD" || category === "HDD") {
    const capacity = storageCapacityGb(text);
    matches = candidates.filter((product) => Array.isArray(product.spec?.capacity_examples_gb) && product.spec.capacity_examples_gb.includes(capacity));
  } else if (category === "MOTHERBOARD") {
    const isAmd = /\b(?:A320|B350|X370|B450|X470|A520|B550|X570|A620|B650|X670|B840|B850|X870)/iu.test(text);
    const isIntel = /\b(?:H110|B150|Z170|B250|Z270|B360|B365|Z370|Z390|B460|Z490|B560|Z590|H610|B660|Z690|B760|Z790|B860|Z890)/iu.test(text);
    if (isAmd !== isIntel) matches = candidates.filter((product) => product.spec?.platform_vendor === (isAmd ? "AMD" : "Intel"));
  } else if (category === "PSU") {
    const formFactor = /\bSFX-?L\b/iu.test(text) ? "SFX-L" : /\bSFX\b|\bSF\d{3,4}\b/iu.test(text) ? "SFX" : /\bATX\b|\bPSU\b|power\s*supply|파워/iu.test(text) ? "ATX" : null;
    const inferredFormFactor = formFactor || (/(?:정격\s*)?\d{3,4}\s*W\b|80\s*PLUS/iu.test(text) ? "ATX" : null);
    matches = candidates.filter((product) => product.spec?.form_factor === inferredFormFactor);
  } else if (category === "COOLING") {
    const subtype = /\bAIO\b|수(?:냉|랭)|water\s*cool/iu.test(text) ? "AIO"
      : /case\s*fan|케이스\s*팬|쿨링\s*팬/iu.test(text) ? "CASE_FAN"
        : /cooler|heat\s*sink|쿨러|공랭|NH-?D15/iu.test(text) ? "AIR_CPU" : null;
    matches = candidates.filter((product) => product.spec?.subtype === subtype);
  } else if (category === "CASE") {
    const chassisClass = /full\s*tower|big\s*tower|빅\s*타워/iu.test(text) ? "FULL_TOWER"
      : /mini\s*tower|미니\s*타워/iu.test(text) ? "MINI_TOWER"
        : /mid\s*tower|middle\s*tower|미들\s*타워|PC\s*case|컴퓨터\s*케이스|케이스|chassis/iu.test(text) ? "MID_TOWER" : null;
    matches = candidates.filter((product) => product.spec?.chassis_class === chassisClass);
  } else if (category === "EXPANSION_CARD") {
    const subtype = /network|ethernet|랜\s*카드|NIC\b|XG-C100C/iu.test(text) ? "NETWORK"
      : /sound|audio|사운드\s*카드/iu.test(text) ? "SOUND"
        : /capture|캡처|캡쳐/iu.test(text) ? "CAPTURE"
          : /RAID|HBA|SAS\s*controller/iu.test(text) ? "HBA_RAID"
            : /M\.2.*(?:carrier|확장)|(?:carrier|확장).*M\.2/iu.test(text) ? "M2_CARRIER" : null;
    matches = candidates.filter((product) => product.spec?.subtype === subtype);
  } else if (category === "ODD") {
    const mediaFamily = /BDXL/iu.test(text) ? "BDXL" : /Blu-?ray|블루레이/iu.test(text) ? "Blu-ray" : /DVD|GP60NB50/iu.test(text) ? "DVD" : null;
    matches = candidates.filter((product) => product.spec?.media_family === mediaFamily);
  }
  return matches.length === 1 ? matches[0] : null;
}

export class PcShadowPipeline {
  constructor({ ledger }) {
    if (!ledger) throw new TypeError("ledger is required");
    this.ledger = ledger;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    for (const source of PC_SOURCE_REGISTRY) {
      this.ledger.upsertSource({
        sourceId: source.key,
        displayName: source.name,
        marketPool: source.market_pool,
        marketPools: source.market_pools,
        policyStatus: source.policy_status,
        runtimeStatus: source.runtime_status,
        policyNote: `access=${source.access.strategy}`
      });
    }
    for (const product of PC_PRODUCT_MASTER_V2) {
      this.ledger.registerProduct({
        canonicalProductId: product.id,
        masterVersion: PC_PRODUCT_MASTER_V2_VERSION,
        canonicalDisplayName: product.name,
        manufacturer: product.manufacturer,
        brand: product.brand,
        categoryCode: product.category,
        productGroupKey: product.group,
        spec: product.spec || {}
      });
      for (const aliasText of product.aliases || []) {
        this.ledger.addAlias({ canonicalProductId: product.id, masterVersion: PC_PRODUCT_MASTER_V2_VERSION, aliasText, validationStatus: "APPROVED" });
      }
      for (const aliasText of product.forbidden || []) {
        this.ledger.addAlias({ canonicalProductId: product.id, masterVersion: PC_PRODUCT_MASTER_V2_VERSION, aliasText, aliasType: "FORBIDDEN", validationStatus: "APPROVED" });
      }
    }
    this.initialized = true;
  }

  backfillLegacyInactive() {
    const hasLegacyListings = this.ledger.db.prepare(`SELECT 1 AS present FROM sqlite_master
      WHERE type = 'table' AND name = 'listings'`).get();
    if (!hasLegacyListings) return { backfilled: 0, skipped: true };
    const migrated = this.ledger.db.prepare("SELECT 1 AS present FROM pc_parts_schema_migrations WHERE version = 1001").get();
    if (migrated) return { backfilled: 0, skipped: true };
    let backfilled = 0;
    let offset = 0;
    const batchSize = 500;
    const legacyColumns = new Set(this.ledger.db.prepare("PRAGMA table_info(listings)").all().map((row) => row.name));
    const categorySelection = legacyColumns.has("category_id") ? "category_id" : "'all' AS category_id";
    const readBatch = this.ledger.db.prepare(`SELECT item_id, site, ${categorySelection}, title, description, price_value, currency, url, last_checked_at
      FROM listings WHERE active = 0 ORDER BY item_id LIMIT ? OFFSET ?`);
    while (true) {
      const rows = readBatch.all(batchSize, offset);
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!PC_SOURCE_REGISTRY.some((source) => source.key === row.site)) continue;
        const candidate = classifyPcPartListing({ title: row.title, description: row.description, price: row.price_value, currency: row.currency });
        if (row.category_id !== "pc" && candidate.category_code === "UNKNOWN") continue;
        this.recordItem({
          item_id: row.item_id,
          site: row.site,
          title: row.title,
          description: row.description,
          price: row.price_value,
          currency: row.currency,
          url: row.url,
          lifecycle_status: "UNAVAILABLE_UNKNOWN",
          availability: "LEGACY_INACTIVE"
        }, row.last_checked_at || new Date().toISOString());
        backfilled += 1;
      }
      offset += rows.length;
    }
    this.ledger.db.prepare("INSERT INTO pc_parts_schema_migrations(version, applied_at) VALUES (1001, ?)")
      .run(new Date().toISOString());
    return { backfilled, skipped: false };
  }

  recordItems(items, { observedAt = new Date().toISOString() } = {}) {
    if (!this.initialized) throw new Error("PC shadow pipeline is not initialized");
    return (Array.isArray(items) ? items : []).map((item) => this.recordItem(item, observedAt));
  }

  pipelineVersions() {
    const active = this.ledger.getActivePipelineVersion?.();
    return active ? {
      normalizationVersion: active.normalization_version,
      parserVersion: active.parser_version,
      ruleVersion: active.rule_version,
      filterVersion: active.filter_version,
      modelVersion: active.model_version
    } : VERSIONS;
  }

  normalizeItem(item, observedAt = new Date().toISOString(), versions = null) {
    const effectiveVersions = versions || this.pipelineVersions();
    const source = getPcSource(item.site);
    const textClassified = classifyPcPartListing(item);
    const sourceCategory = trustedSpecialistCategory(item);
    const sourceCategoryEligible = sourceCategory && !["COMPONENT_BUNDLE", "FULL_SYSTEM", "MONITOR"].includes(textClassified.listing_kind);
    const sourceCategoryManufacturer = sourceCategoryEligible
      ? detectPcPartManufacturer(`${item.title || ""} ${item.description || ""}`, sourceCategory)
      : null;
    const classified = sourceCategoryEligible ? {
      ...textClassified,
      category_code: sourceCategory,
      manufacturer: textClassified.manufacturer || sourceCategoryManufacturer,
      confidence: { ...textClassified.confidence, category: 0.995 },
      evidence: [
        ...textClassified.evidence,
        { field: "category_code", value: sourceCategory, source: "STRUCTURED_SOURCE_CATEGORY", matched_text: item.source_category_code },
        ...(sourceCategoryManufacturer && !textClassified.manufacturer
          ? [{ field: "manufacturer", value: sourceCategoryManufacturer, source: "STRUCTURED_CATEGORY_TEXT" }]
          : [])
      ]
    } : textClassified;
    const publicClassified = classifyPcPartListingPublic({
      ...item,
      title: sourceCategoryEligible ? `${sourceCategory} ${item.title || ""}` : item.title,
      description: item.description
    });
    const publicSupportedCategory = ["CPU", "GPU", "RAM", "MOTHERBOARD", "SSD", "HDD", "PSU"].includes(publicClassified.category_code);
    const duplicate = duplicateIdentity(item);
    const exactAlias = classified.canonical_model
      ? this.ledger.matchAlias(classified.category_code, classified.canonical_model)
      : null;
    const textAlias = this.ledger.matchAliasInText(
      classified.category_code,
      `${item.title || ""} ${item.description || ""}`
    );
    const alias = exactAlias?.matched
      ? exactAlias
      : textAlias?.matched
        ? textAlias
        : exactAlias?.forbidden
          ? exactAlias
          : textAlias;
    const aliasMatched = Boolean(alias?.matched && !alias?.forbidden);
    const facetProduct = aliasMatched ? null : directoryFacetProduct(classified, `${item.title || ""} ${item.description || ""}`);
    let product = aliasMatched
      ? this.ledger.getCanonicalProduct(alias.canonical_product_id, alias.master_version)
      : facetProduct ? this.ledger.getCanonicalProduct(facetProduct.id, PC_PRODUCT_MASTER_V2_VERSION) : null;
    if (!cpuProductMatchesClassification(classified, product)) product = null;
    const matched = Boolean(product);
    const exclusionReasons = [...classified.exclusion_reasons];
    if (!matched) exclusionReasons.push("MODEL_NOT_IN_MASTER");
    const quantityValid = Number.isInteger(classified.quantity) && classified.quantity > 0;
    const priceScopeValid = ["TOTAL", "UNIT"].includes(classified.price_scope);
    if (!quantityValid) exclusionReasons.push("QUANTITY_UNKNOWN");
    if (!priceScopeValid) exclusionReasons.push("PRICE_SCOPE_AMBIGUOUS");
    const price = Number.isFinite(Number(item.price)) ? Number(item.price) : null;
    const prices = quantityValid && priceScopeValid
      ? comparablePrices(price, classified.quantity, classified.price_scope)
      : { unitPrice: null, totalPrice: null };
    const state = lifecycle(item);
    const listingMarketPool = classified.seller_type === "DEALER" && source.market_pools.includes("KR_DEALER_USED")
      ? "KR_DEALER_USED"
      : source.market_pool;
    const cohortScopedReasons = new Set([
      ...(listingMarketPool === "KR_DEALER_USED" ? ["DEALER_LISTING"] : []),
      ...(classified.condition === "BROKEN" ? ["BROKEN"] : []),
      ...(classified.condition === "MINED" ? ["MINED"] : []),
      ...(classified.condition === "UNTESTED" ? ["UNTESTED"] : []),
      ...(classified.condition === "NEW" ? ["NOT_USED_WORKING"] : []),
      ...(classified.condition === "REFURBISHED" && listingMarketPool === "KR_REFURB_RETAIL" ? ["REFURBISHED_POOL_ONLY"] : [])
    ]);
    const statsExclusionReasons = exclusionReasons.filter((reason) => (
      !cohortScopedReasons.has(reason) && !(facetProduct && reason === "MODEL_AMBIGUOUS")
    ));
    const statisticsExclusionReasons = [...new Set([
      ...statsExclusionReasons,
      ...(publicClassified.statistics_exclusion_reasons || [])
    ])];
    let priceEligible = matched && prices.unitPrice !== null && statsExclusionReasons.length === 0;
    let statisticsEligible = publicSupportedCategory && matched && prices.unitPrice !== null
      && publicClassified.statistics_eligible === true && statsExclusionReasons.length === 0;
    let stats = null;
    if (matched && priceEligible) {
      stats = this.ledger.getPriceStats({
        canonicalProductId: product.canonical_product_id,
        days: 30,
        marketPool: listingMarketPool,
        condition: classified.condition,
        currency: item.currency || (source.market_pool === "OVERSEAS_USED" ? "USD" : "KRW"),
        asOf: observedAt,
        normalizationVersion: effectiveVersions.normalizationVersion,
        parserVersion: effectiveVersions.parserVersion,
        ruleVersion: effectiveVersions.ruleVersion,
        filterVersion: effectiveVersions.filterVersion
      });
    }
    const reference = Number(stats?.sold?.median);
    const anomalouslyLow = Number.isFinite(reference) && reference > 0 && Number.isFinite(prices.unitPrice) && prices.unitPrice < reference * 0.4;
    if (anomalouslyLow) {
      exclusionReasons.push("ANOMALOUS_LOW_PRICE");
      statsExclusionReasons.push("ANOMALOUS_LOW_PRICE");
      statisticsExclusionReasons.push("ANOMALOUS_LOW_PRICE");
      priceEligible = false;
      statisticsEligible = false;
    }
    const exactSku = matched && product?.spec?.directory_node_type === "PRODUCT";
    const exactAggregationIdentity = matched && ["PRODUCT", "BROWSE_BUCKET", "BROWSE_FACET"]
      .includes(product?.spec?.directory_node_type);
    const normalized = {
      normalizationVersion: Number(effectiveVersions.normalizationVersion || 1),
      canonicalProductId: product?.canonical_product_id || null,
      canonicalDisplayName: product?.canonical_display_name || null,
      canonicalManufacturer: classified.category_code === "GPU"
        ? classified.gpu_board_manufacturer || null
        : product?.manufacturer || null,
      categoryCode: classified.category_code,
      publicCategoryCode: publicClassified.category_code,
      marketSegment: publicClassified.market_segment,
      listingType: publicClassified.listing_type,
      conditionGroup: publicClassified.condition_group,
      specGroupId: publicClassified.spec_group_id,
      classificationConfidence: publicClassified.classification_confidence,
      modelConfidence: publicClassified.model_confidence,
      quantityConfidence: publicClassified.quantity_confidence,
      priceScopeConfidence: publicClassified.price_scope_confidence,
      statisticsEligible,
      statisticsExclusionReasons: [...new Set(statisticsExclusionReasons)],
      listingKind: classified.listing_kind,
      quantity: classified.quantity,
      priceScope: classified.price_scope,
      conditionCode: classified.condition,
      marketPool: listingMarketPool,
      // The ledger column is the historical statistics-identity flag. A uniquely
      // matched directory bucket/facet is safe for its explicitly labelled group
      // statistics, but it is not an exact SKU and must not qualify as a good deal.
      exactProduct: exactAggregationIdentity,
      priceEligible,
      exclusionReasons: [...new Set(statsExclusionReasons)],
      confidence: {
        ...classified.confidence,
        status: state.evidence.type === "INFERRED_DEFAULT" ? 0.7 : 0.99,
        dedupe: duplicate ? 0.99 : classified.confidence.dedupe
      },
      evidence: [
        ...classified.evidence,
        ...(facetProduct ? [{ field: "canonical_product_id", value: facetProduct.id, source: "MANUFACTURER_FACET_MATCH" }] : []),
        { field: "lifecycle_status", value: state.status, source: state.evidence.type },
        ...(duplicate ? [{ field: "dedupe", value: duplicate.clusterKey, source: "MULTI_SIGNAL_FINGERPRINT" }] : [])
      ],
      unitPrice: prices.unitPrice,
      totalPrice: prices.totalPrice,
      spec: {
        ...(product?.spec || {}),
        exact_sku: exactSku,
        ...(classified.gpu_board_manufacturer ? { board_manufacturer: classified.gpu_board_manufacturer } : {}),
        ...(classified.module_capacity_gb ? { module_capacity_gb: classified.module_capacity_gb } : {}),
        ...(classified.total_capacity_gb ? { total_capacity_gb: classified.total_capacity_gb } : {})
      }
    };
    if (["COMPONENT_BUNDLE", "FULL_SYSTEM"].includes(classified.listing_kind)) {
      const components = this.ledger.findApprovedProductsInText(`${item.title || ""} ${item.description || ""}`);
      if (components.length >= 2) {
        normalized.items = componentItemsWithExplicitPrices(`${item.title || ""} ${item.description || ""}`, components);
      }
    }
    return {
      source,
      classified,
      versions: effectiveVersions,
      state,
      price,
      prices,
      stats,
      reference,
      anomalouslyLow,
      normalized,
      exclusionReasons,
      priceEligible,
      duplicate
    };
  }

  recordItem(item, observedAt) {
    const {
      source,
      classified,
      versions,
      state,
      price,
      stats,
      reference,
      anomalouslyLow,
      normalized,
      exclusionReasons,
      priceEligible,
      duplicate
    } = this.normalizeItem(item, observedAt);
    const observation = this.ledger.recordObservation({
      sourceId: source.key,
      sourceListingId: sourceListingId(item),
      observedAt,
      title: item.title,
      description: item.description,
      sellerRef: item.seller_name || item.seller_ref,
      rawPayload: item.raw_payload
        ? {
            ...item.raw_payload,
            item_id: item.item_id || item.id || item.raw_payload.item_id || item.raw_payload.id,
            site: item.site || item.raw_payload.site,
            url: item.url || item.raw_payload.url || item.raw_payload.item_url,
            image_url: item.image_url || item.raw_payload.image_url,
            posted_at: item.posted_at || item.raw_payload.posted_at,
            search_text: item.search_text || item.raw_payload.search_text || item.title,
            category_id: item.category_id || item.raw_payload.category_id || "pc",
            source_listing_id: sourceListingId(item),
            requested_category_code: item.requested_category_code || item.raw_payload.requested_category_code,
            source_category_code: item.source_category_code || item.raw_payload.source_category_code
          }
        : item,
      price,
      currency: item.currency || (source.market_pool === "OVERSEAS_USED" ? "USD" : "KRW"),
      status: state.status,
      statusEvidence: state.evidence,
      availability: state.status === "ACTIVE" ? "AVAILABLE" : item.availability || "UNKNOWN",
      transactionPrice: item.transaction_price,
      transactionEvidence: item.transaction_price_evidence,
      normalized,
      versions
    });
    const activeVersion = this.ledger.getActivePipelineVersion?.();
    const rollbackVersion = activeVersion?.previous_version_key
      ? this.ledger.db.prepare("SELECT * FROM pc_pipeline_versions WHERE version_key = ?").get(activeVersion.previous_version_key)
      : null;
    if (rollbackVersion && rollbackVersion.version_key !== activeVersion.version_key) {
      const alreadyDualWritten = this.ledger.db.prepare(`SELECT 1 FROM normalized_listings
        WHERE snapshot_id = ? AND normalization_version = ? AND parser_version = ?
          AND rule_version = ? AND filter_version = ?`).get(
        observation.snapshotId, rollbackVersion.normalization_version, rollbackVersion.parser_version,
        rollbackVersion.rule_version, rollbackVersion.filter_version
      );
      if (!alreadyDualWritten) {
        const rollbackVersions = {
          normalizationVersion: rollbackVersion.normalization_version,
          parserVersion: rollbackVersion.parser_version,
          ruleVersion: rollbackVersion.rule_version,
          filterVersion: rollbackVersion.filter_version,
          modelVersion: rollbackVersion.model_version
        };
        const rollbackNormalized = this.normalizeItem(item, observedAt, rollbackVersions).normalized;
        this.ledger.insertNormalization(
          observation.snapshotId,
          rollbackNormalized,
          price,
          item.currency || (source.market_pool === "OVERSEAS_USED" ? "USD" : "KRW"),
          rollbackVersions
        );
      }
    }
    if (duplicate) {
      this.ledger.assignDuplicateCluster({
        snapshotId: observation.snapshotId,
        clusterKey: duplicate.clusterKey,
        confidence: 0.99,
        evidence: duplicate.evidence
      });
    }
    const modelCandidateText = classified.canonical_model || unknownModelCandidate(item.title);
    if (!normalized.exactProduct && modelCandidateText) {
      this.ledger.observeModelCandidate({
        snapshotId: observation.snapshotId,
        categoryCode: classified.category_code,
        candidateText: modelCandidateText,
        evidence: { title: item.title, classifier_evidence: classified.evidence },
        observedAt
      });
    }

    const goodListingEligible = state.status === "ACTIVE"
      && (item.availability === undefined || item.availability === null || item.availability === "AVAILABLE")
      && normalized.marketPool === "KR_C2C_USED"
      && classified.condition === "USED_WORKING"
      && classified.exclusion_reasons.length === 0
      && normalized.spec?.exact_sku === true
      && priceEligible
      && !anomalouslyLow
      && Number(stats?.sold?.sample_count || 0) >= 5;
    const projection = {
      ...item,
      canonical_product_id: normalized.canonicalProductId,
      canonical_display_name: normalized.canonicalDisplayName,
      canonical_manufacturer: normalized.canonicalManufacturer,
      chip_manufacturer: normalized.spec?.chip_manufacturer || null,
      board_manufacturer: normalized.spec?.board_manufacturer || null,
      listing_kind: normalized.listingKind,
      category_code: normalized.categoryCode,
      pc_category_code: normalized.publicCategoryCode,
      market_segment: normalized.marketSegment,
      listing_type: normalized.listingType,
      condition_group: normalized.conditionGroup,
      spec_group_id: normalized.specGroupId,
      classification_confidence: normalized.classificationConfidence,
      model_confidence: normalized.modelConfidence,
      quantity_confidence: normalized.quantityConfidence,
      price_scope_confidence: normalized.priceScopeConfidence,
      statistics_eligible: normalized.statisticsEligible,
      statistics_exclusion_reasons: normalized.statisticsExclusionReasons,
      parser_version: versions.parserVersion,
      rule_version: versions.ruleVersion,
      quantity: normalized.quantity,
      price_scope: normalized.priceScope,
      condition_code: normalized.conditionCode,
      lifecycle_status: state.status,
      market_pool: normalized.marketPool,
      confidence: normalized.confidence,
      evidence: normalized.evidence,
      price_eligible: priceEligible,
      exclusion_reasons: [...new Set(exclusionReasons)],
      good_listing_eligible: goodListingEligible,
      reference_price: Number.isFinite(reference) ? reference : null
    };
    Object.defineProperty(projection, "_pc_snapshot_created", {
      value: observation.snapshotCreated === true,
      enumerable: false,
      configurable: false,
      writable: false
    });
    return projection;
  }

  reconcileCompleteCollection({ sourceKey, items, checkedAt }) {
    return this.ledger.reconcileSourceObservation({
      sourceKey,
      observedListingIds: (Array.isArray(items) ? items : []).map(sourceListingId),
      checkedAt
    });
  }
}

export { VERSIONS as PC_PIPELINE_VERSIONS };
