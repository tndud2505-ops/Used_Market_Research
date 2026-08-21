export type CategoryHarnessStrategy = "source_category" | "keyword";

export type CategoryHarnessConfidence = "exact" | "aggregate_exact" | "broader_source" | "unknown";

export interface CategoryHarnessNode {
  id: string;
  label: string;
  description: string;
  parentId?: string | null;
}

export interface CategoryHarnessBinding {
  sourceCategoryId: string;
  sourceCategoryIds?: string[];
  sourceCategoryPath: string[];
  sourceCategoryPaths?: Record<string, string[]>;
  collectionMode?: "single" | "aggregate";
  confidence?: CategoryHarnessConfidence;
}

export interface CategoryHarnessSite {
  siteKey: string;
  bindings: Partial<Record<string, CategoryHarnessBinding>>;
}

export interface CategoryHarnessPlan {
  requestedCategoryId: string;
  resolvedCategoryId: string | null;
  strategy: CategoryHarnessStrategy;
  binding: CategoryHarnessBinding | null;
}

export interface CategoryHarnessApiPlan extends CategoryHarnessPlan {
  availability: "official" | "parent_fallback" | "unavailable";
  selectable: boolean;
}

export interface CategoryHarnessValidation {
  ok: boolean;
  errors: string[];
  siteCount: number;
  categoryCount: number;
  planCount: number;
}

export interface CategoryHarness {
  listSiteKeys(): string[];
  getSourceCategoryBinding(siteKey: string, categoryId: string): CategoryHarnessBinding | null;
  resolveCategoryCollectionPlan(siteKey: string, categoryId: string): CategoryHarnessPlan | null;
  isCategorySelectableForSite(siteKey: string, categoryId: string): boolean;
  categoryPlansForApi(): Record<string, Record<string, CategoryHarnessApiPlan>>;
  sourceBindingsForApi(): Record<string, Record<string, CategoryHarnessBinding>>;
  validate(): CategoryHarnessValidation;
}

function cloneBinding(binding: CategoryHarnessBinding): CategoryHarnessBinding {
  return {
    ...binding,
    sourceCategoryIds: binding.sourceCategoryIds?.length
      ? [...binding.sourceCategoryIds]
      : [binding.sourceCategoryId],
    sourceCategoryPath: [...binding.sourceCategoryPath],
    sourceCategoryPaths: binding.sourceCategoryPaths
      ? Object.fromEntries(Object.entries(binding.sourceCategoryPaths).map(([key, path]) => [key, [...path]]))
      : undefined,
    collectionMode: binding.collectionMode ?? (binding.sourceCategoryIds && binding.sourceCategoryIds.length > 1 ? "aggregate" : "single"),
    confidence: binding.confidence ?? "exact"
  };
}

function broaderBinding(binding: CategoryHarnessBinding): CategoryHarnessBinding {
  return { ...cloneBinding(binding), confidence: "broader_source" };
}

export function createCategoryHarness(
  categories: readonly CategoryHarnessNode[],
  sites: readonly CategoryHarnessSite[]
): CategoryHarness {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const siteByKey = new Map(sites.map((site) => [site.siteKey, site]));

  function getSourceCategoryBinding(siteKey: string, categoryId: string): CategoryHarnessBinding | null {
    const binding = siteByKey.get(siteKey)?.bindings[categoryId];
    return binding ? cloneBinding(binding) : null;
  }

  function resolveCategoryCollectionPlan(siteKey: string, categoryId: string): CategoryHarnessPlan | null {
    const category = categoryById.get(categoryId);
    if (!category || category.id === "all") return null;

    let candidateId: string | undefined = category.id;
    let isBroaderSource = false;
    while (candidateId) {
      const binding = getSourceCategoryBinding(siteKey, candidateId);
      if (binding) {
        return {
          requestedCategoryId: category.id,
          resolvedCategoryId: candidateId,
          strategy: "source_category",
          binding: isBroaderSource ? broaderBinding(binding) : binding
        };
      }

      const parentId: string | null | undefined = categoryById.get(candidateId)?.parentId;
      if (!parentId) break;
      candidateId = parentId;
      isBroaderSource = true;
    }

    return {
      requestedCategoryId: category.id,
      resolvedCategoryId: null,
      strategy: "keyword",
      binding: null
    };
  }

  function isCategorySelectableForSite(siteKey: string, categoryId: string): boolean {
    if (categoryId === "all") return true;
    const plan = resolveCategoryCollectionPlan(siteKey, categoryId);
    return plan?.strategy === "source_category" && plan.resolvedCategoryId === categoryId;
  }

  function categoryPlansForApi(): Record<string, Record<string, CategoryHarnessApiPlan>> {
    return Object.fromEntries(
      sites.map((site) => [
        site.siteKey,
        Object.fromEntries(
          categories
            .filter((category) => category.id !== "all")
            .map((category) => {
              const plan = resolveCategoryCollectionPlan(site.siteKey, category.id);
              const availability = plan?.strategy === "source_category"
                ? plan.resolvedCategoryId === category.id ? "official" : "parent_fallback"
                : "unavailable";
              return [category.id, {
                ...(plan ?? {
                  requestedCategoryId: category.id,
                  resolvedCategoryId: null,
                  strategy: "keyword" as const,
                  binding: null
                }),
                availability,
                selectable: availability === "official"
              } satisfies CategoryHarnessApiPlan];
            })
        )
      ])
    );
  }

  function sourceBindingsForApi(): Record<string, Record<string, CategoryHarnessBinding>> {
    return Object.fromEntries(
      sites.map((site) => [
        site.siteKey,
        Object.fromEntries(
          Object.entries(site.bindings)
            .filter((entry): entry is [string, CategoryHarnessBinding] => Boolean(entry[1]))
            .map(([categoryId, binding]) => [categoryId, cloneBinding(binding)])
        )
      ])
    );
  }

  function validate(): CategoryHarnessValidation {
    const errors: string[] = [];
    const categoryIds = new Set<string>();
    for (const category of categories) {
      if (!category.id.trim()) errors.push("category id must not be empty");
      if (categoryIds.has(category.id)) errors.push(`duplicate category id: ${category.id}`);
      categoryIds.add(category.id);
      if (category.parentId && !categoryById.has(category.parentId)) {
        errors.push(`category ${category.id} references missing parent ${category.parentId}`);
      }
    }

    const siteKeys = new Set<string>();
    for (const site of sites) {
      if (!site.siteKey.trim()) errors.push("site key must not be empty");
      if (siteKeys.has(site.siteKey)) errors.push(`duplicate category site key: ${site.siteKey}`);
      siteKeys.add(site.siteKey);

      for (const [categoryId, rawBinding] of Object.entries(site.bindings)) {
        if (!rawBinding) {
          errors.push(`${site.siteKey}/${categoryId} binding must not be empty`);
          continue;
        }
        const binding = rawBinding;
        if (!categoryById.has(categoryId)) errors.push(`${site.siteKey} binding references unknown category ${categoryId}`);
        if (!binding.sourceCategoryId.trim()) errors.push(`${site.siteKey}/${categoryId} sourceCategoryId must not be empty`);
        if (binding.sourceCategoryIds?.some((sourceId) => !sourceId.trim())) {
          errors.push(`${site.siteKey}/${categoryId} contains an empty source category ID`);
        }
        if (binding.sourceCategoryPath.length === 0) errors.push(`${site.siteKey}/${categoryId} sourceCategoryPath must not be empty`);
      }
    }

    const nonRootCategories = categories.filter((category) => category.id !== "all");
    const planCount = sites.length * nonRootCategories.length;
    for (const site of sites) {
      for (const category of nonRootCategories) {
        const plan = resolveCategoryCollectionPlan(site.siteKey, category.id);
        if (!plan || !["source_category", "keyword"].includes(plan.strategy)) {
          errors.push(`${site.siteKey}/${category.id} has no valid collection plan`);
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      siteCount: sites.length,
      categoryCount: nonRootCategories.length,
      planCount
    };
  }

  return {
    listSiteKeys: () => sites.map((site) => site.siteKey),
    getSourceCategoryBinding,
    resolveCategoryCollectionPlan,
    isCategorySelectableForSite,
    categoryPlansForApi,
    sourceBindingsForApi,
    validate
  };
}
