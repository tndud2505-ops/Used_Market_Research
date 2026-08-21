// Derived from market/logic/category-catalog.ts SOURCE_CATEGORY_BINDINGS.
// Single bindings are normalized to one-element arrays; aggregate bindings keep
// the catalog's sourceCategoryIds order unchanged.
const SOURCE_CATEGORY_MAP = Object.freeze({
  joonggonara: Object.freeze({
    luxury: Object.freeze(["1"]),
    fashion: Object.freeze(["2"]),
    fashion_women: Object.freeze(["111"]),
    fashion_men: Object.freeze(["112"]),
    fashion_women_outer: Object.freeze(["1021", "1022"]),
    fashion_women_tops: Object.freeze(["1023", "1024", "1025"]),
    fashion_women_bottoms: Object.freeze(["1026"]),
    fashion_women_skirts: Object.freeze(["1027"]),
    fashion_men_outer: Object.freeze(["1030", "1031"]),
    fashion_men_tops: Object.freeze(["1032", "1033", "1034"]),
    fashion_men_bottoms: Object.freeze(["1035"]),
    fashion_goods: Object.freeze(["3"]),
    beauty: Object.freeze(["4"]),
    kids: Object.freeze(["5"]),
    mobile: Object.freeze(["6"]),
    appliances: Object.freeze(["7"]),
    pc: Object.freeze(["8"]),
    camera: Object.freeze(["9"]),
    furniture: Object.freeze(["10"]),
    living: Object.freeze(["11"]),
    games: Object.freeze(["12"]),
    hobby: Object.freeze(["13"]),
    books: Object.freeze(["14"]),
    tickets: Object.freeze(["15"]),
    sports: Object.freeze(["16"]),
    travel: Object.freeze(["17"]),
    vehicles: Object.freeze(["1367"]),
    motorcycle: Object.freeze(["19"]),
    tools: Object.freeze(["20"]),
    free_share: Object.freeze(["21"])
  }),
  bunjang: Object.freeze({
    fashion: Object.freeze(["310", "320"]),
    fashion_women: Object.freeze(["310"]),
    fashion_men: Object.freeze(["320"]),
    fashion_women_outer: Object.freeze(["310300"]),
    fashion_women_tops: Object.freeze(["310260"]),
    fashion_women_bottoms: Object.freeze(["310150"]),
    fashion_women_skirts: Object.freeze(["310130"]),
    fashion_men_outer: Object.freeze(["320300"]),
    fashion_men_tops: Object.freeze(["320210"]),
    fashion_men_bottoms: Object.freeze(["320120"]),
    fashion_men_jumpsuit: Object.freeze(["320400"]),
    fashion_goods: Object.freeze(["405", "430", "421", "422", "400"]),
    beauty: Object.freeze(["410"]),
    kids: Object.freeze(["500"]),
    mobile: Object.freeze(["600700", "600710", "600720"]),
    appliances: Object.freeze(["610"]),
    pc: Object.freeze(["600100", "600200"]),
    camera: Object.freeze(["600300"]),
    furniture: Object.freeze(["810"]),
    living: Object.freeze(["800"]),
    games: Object.freeze(["600600"]),
    hobby: Object.freeze(["980", "930", "910", "990"]),
    books: Object.freeze(["900100", "900500", "920100"]),
    tickets: Object.freeze(["900210", "900220", "900230"]),
    sports: Object.freeze(["700"]),
    motorcycle: Object.freeze(["750800", "750810"]),
    tools: Object.freeze(["830"])
  })
});

function sourceCategoryIds(site, categoryId) {
  const siteMap = typeof site === "string" ? SOURCE_CATEGORY_MAP[site] : undefined;
  if (!siteMap || !Object.hasOwn(siteMap, categoryId)) return [];
  return [...siteMap[categoryId]];
}

function hasOfficialCategory(site, categoryId) {
  const siteMap = typeof site === "string" ? SOURCE_CATEGORY_MAP[site] : undefined;
  return Boolean(siteMap && Object.hasOwn(siteMap, categoryId) && siteMap[categoryId].length > 0);
}

export { sourceCategoryIds, hasOfficialCategory };
