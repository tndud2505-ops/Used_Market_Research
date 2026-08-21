import { RESULT_PAGE_SIZE, clampResultPage, paginationItems, resultPageCount } from './pagination.mjs?v=global-english-v4';

const APP_ID = 'global';
const API_BASE_PATH = '/global/api';
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const storageKey = (base) => `${base}:global`;
const GLOBAL_MARKET = {
  defaultCountry: 'jp',
  countries: {
    jp: {
      label: 'Japan',
      sites: ['mercari_jp', 'yahoo_auction_jp', 'rakuma'],
      idleText: 'Search and compare public resale listings from Japan.'
    },
    us: {
      label: 'United States',
      sites: ['ebay', 'poshmark', 'vinted', 'unclaimed_baggage'],
      idleText: 'Search and compare public resale listings from the United States.'
    }
  }
};
const INITIAL_COUNTRY = PAGE_PARAMS.get('country') === 'us' ? 'us' : 'jp';
let DEFAULT_SITES = GLOBAL_MARKET.countries[INITIAL_COUNTRY].sites;
const SEARCH_ONLY_SITES = new Set(['mercari_jp', 'yahoo_auction_jp', 'rakuma', 'ebay', 'poshmark', 'vinted', 'unclaimed_baggage']);
const LISTING_HOSTS_BY_SITE = {
  mercari_jp: ['mercari.com'],
  yahoo_auction_jp: ['auctions.yahoo.co.jp'],
  rakuma: ['fril.jp'],
  ebay: ['ebay.com'],
  poshmark: ['poshmark.com'],
  vinted: ['vinted.com'],
  unclaimed_baggage: ['unclaimedbaggage.com']
};
const IMAGE_HOSTS = [
  'static.mercdn.net',
  'auc-pctr.c.yimg.jp',
  'auctions.c.yimg.jp',
  'img.fril.jp',
  'ebayimg.com',
  'images.poshmark.com',
  'dnvefa72aowie.cloudfront.net',
  'vinted.net',
  'unclaimedbaggage.com'
];
const SITE_RESULT_WINDOW_INITIAL = 160;
const SITE_RESULT_WINDOW_STEP = 160;
const SITE_RESULT_WINDOW_MAX = 640;
const SEARCH_SESSION_MAX_ITEMS = 1000;
const MAX_EMPTY_CONTINUATION_HOPS = 3;
const MAX_EXPANSION_REQUESTS = 8;
const state = {
  data: null,
  loading: false,
  appendError: '',
  query: '',
  categoryId: 'all',
  categoryIds: [],
  categories: [],
  categoryCatalogStatus: 'pending',
  sitePlans: {},
  activeCountry: INITIAL_COUNTRY,
  activeSite: 'all',
  sort: 'recommended',
  minPrice: null,
  maxPrice: null,
  showFavorites: false,
  requestController: null,
  sessionId: null,
  sessionGeneration: null,
  sessionWindow: null,
  sessionViewPending: false,
  collectionSites: [],
  collectionData: null,
  viewData: new Map(),
  focusedSiteWindows: {},
  favorites: loadFavorites(),
  favoriteItems: loadFavoriteItems(),
  recentItems: loadRecentItems(),
  recentSearches: loadRecentSearches(),
  priceFilterIgnored: false,
  priceFilterCurrency: INITIAL_COUNTRY === 'jp' ? 'JPY' : 'USD',
  categoryPanelOpen: false,
  currentPage: 0,
  siteWindow: SITE_RESULT_WINDOW_INITIAL,
  expansionExhausted: false,
  refreshTimer: null,
  refreshToken: '',
  refreshAttempt: 0,
  refreshFingerprint: '',
  refreshMessage: '',
  pendingRefreshData: null,
  pendingResultKind: ''
};

const labels = {
  all: 'All',
  mercari_jp: 'Mercari JP',
  yahoo_auction_jp: 'Yahoo! Auctions',
  rakuma: 'Rakuma',
  ebay: 'eBay',
  poshmark: 'Poshmark',
  vinted: 'Vinted US',
  unclaimed_baggage: 'Unclaimed Baggage'
};

const fallbackCategories = [
  ['all', 'All', null], ['fashion', 'Fashion', null], ['fashion_women', "Women's Fashion", 'fashion'], ['fashion_men', "Men's Fashion", 'fashion'],
  ['fashion_women_outer', "Women's Outerwear", 'fashion_women'], ['fashion_women_tops', "Women's Tops", 'fashion_women'],
  ['fashion_women_bottoms', "Women's Bottoms", 'fashion_women'], ['fashion_women_skirts', "Women's Skirts", 'fashion_women'],
  ['fashion_men_outer', "Men's Outerwear", 'fashion_men'], ['fashion_men_tops', "Men's Tops", 'fashion_men'],
  ['fashion_men_bottoms', "Men's Bottoms", 'fashion_men'], ['fashion_men_jumpsuit', "Men's Jumpsuits", 'fashion_men'],
  ['fashion_goods', 'Fashion Accessories', null], ['luxury', 'Luxury', null],
  ['beauty', 'Beauty'], ['kids', 'Kids & Baby'], ['mobile', 'Phones & Tablets'], ['appliances', 'Appliances'],
  ['pc', 'Computers'], ['camera', 'Cameras'], ['furniture', 'Furniture'], ['living', 'Home & Living'],
  ['games', 'Games'], ['hobby', 'Hobbies & Pets'], ['books', 'Books & Media'], ['tickets', 'Tickets'],
  ['sports', 'Sports'], ['travel', 'Travel & Outdoors'], ['vehicles', 'Vehicles'], ['motorcycle', 'Motorcycles'],
  ['tools', 'Tools'], ['free_share', 'Free']
].map(([id, label, parentId = null]) => ({ id, label, parentId, description: '' }));

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function allowedHttpsUrl(value, allowedHosts) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const allowed = allowedHosts.some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || !allowed) return '';
    return url.href;
  } catch {
    return '';
  }
}

function safeListingUrl(item) {
  return allowedHttpsUrl(item?.url, LISTING_HOSTS_BY_SITE[item?.site] || []);
}

function safeImageUrl(value) {
  return allowedHttpsUrl(value, IMAGE_HOSTS);
}

function applyMarketShellCopy() {
  document.documentElement.lang = 'en';
  const text = (selector, value) => {
    const node = $(selector);
    if (node) node.textContent = value;
  };
  const attr = (selector, name, value) => {
    const node = $(selector);
    if (node) node.setAttribute(name, value);
  };
  text('.skip-link', 'Skip to content');
  attr('.brand', 'aria-label', 'USED Market home');
  text('label[for="keyword"]', 'Search products');
  text('#search-button span', 'Search');
  text('#recent-searches-title', 'Recent Searches');
  text('#clear-recent-searches', 'Clear All');
  text('.category-heading .eyebrow', 'BROWSE');
  text('.category-heading h2', 'Categories');
  attr('#category-panel-toggle', 'aria-label', 'Show categories');
  attr('#country-tabs', 'aria-label', 'Search country');
  attr('#site-tabs', 'aria-label', 'Search sites');
  attr('.idle-mascot', 'alt', 'USED Market search assistant');
  const idleTitle = $('#idle-title');
  if (idleTitle) idleTitle.innerHTML = 'Global used listings<br />search';
  text('#result-count', '0 results');
  text('#apply-refresh-results', 'View new listings');
  attr('.filter-dock', 'aria-label', 'Price range');
  text('label[for="keyword"]', 'Search products');
  text('.filter-dock label:nth-of-type(1) .sr-only', 'Minimum price');
  text('.filter-dock label:nth-of-type(2) .sr-only', 'Maximum price');
  attr('#min-price', 'aria-label', 'Minimum price');
  attr('#max-price', 'aria-label', 'Maximum price');
  text('#apply-price-filter', 'Apply');
  text('#reset-filters', 'Reset');
  attr('#sort-tabs', 'aria-label', 'Sort results');
  text('[data-sort="recommended"]', 'Recommended');
  text('[data-sort="price_asc"]', 'Price: Low to High');
  text('[data-sort="price_desc"]', 'Price: High to Low');
  text('[data-sort="recent"]', 'Newest');
  attr('#pagination-controls', 'aria-label', 'Search result pages');
  text('#recent-viewed-title', 'Recently Viewed');
  attr('#recent-viewed', 'aria-label', 'Recently viewed listings');
  $('.coupang-banner')?.remove();
  text('.site-footer p', 'Public used listings from verified marketplace pages.');
  attr('.site-footer nav', 'aria-label', 'Service information');
  const footerNav = $('.site-footer nav');
  if (footerNav) {
    footerNav.innerHTML = [
      ['Japan Search', '/global/?country=jp'],
      ['United States Search', '/global/?country=us']
    ].map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  }
  const description = 'Search and compare public used listings from marketplaces in Japan and the United States.';
  const title = 'Global Used Listings Search | USED MARKET';
  const canonicalUrl = `https://global.used-pick.com/global/?country=${state.activeCountry}`;
  document.title = title;
  attr('meta[name="description"]', 'content', description);
  attr('meta[property="og:title"]', 'content', title);
  attr('meta[property="og:description"]', 'content', description);
  attr('meta[property="og:locale"]', 'content', 'en_US');
  attr('meta[property="og:url"]', 'content', canonicalUrl);
  attr('meta[name="twitter:title"]', 'content', title);
  attr('meta[name="twitter:description"]', 'content', description);
  attr('link[rel="canonical"]', 'href', canonicalUrl);
  const structuredData = document.querySelector('script[type="application/ld+json"]');
  if (structuredData) {
    try {
      const data = JSON.parse(structuredData.textContent || '{}');
      data.name = title;
      data.inLanguage = 'en-US';
      data.description = description;
      data.url = canonicalUrl;
      data['@id'] = `${canonicalUrl}#website`;
      structuredData.textContent = JSON.stringify(data);
    } catch {
      // Static metadata remains usable if an extension rewrites the JSON-LD block.
    }
  }
}

function renderMarketProfile() {
  applyMarketShellCopy();
  const countryTabs = $('#country-tabs');
  const countryProfile = GLOBAL_MARKET.countries[state.activeCountry] || GLOBAL_MARKET.countries[GLOBAL_MARKET.defaultCountry];
  DEFAULT_SITES = countryProfile.sites;
  if (countryTabs) {
    countryTabs.hidden = false;
    countryTabs.innerHTML = Object.entries(GLOBAL_MARKET.countries).map(([country, details]) => {
      const active = state.activeCountry === country;
      return `<button class="${active ? 'active' : ''}" type="button" aria-pressed="${active}" data-country-tab="${escapeHtml(country)}">${escapeHtml(details.label)}</button>`;
    }).join('');
  }
  const tabs = $('#site-tabs');
  if (tabs) {
    tabs.innerHTML = [
      `<button class="${state.activeSite === 'all' ? 'active' : ''}" type="button" aria-pressed="${state.activeSite === 'all'}" data-site-tab="all">${'All'}</button>`,
      ...DEFAULT_SITES.map((site) => {
        const active = state.activeSite === site;
        return `<button class="${active ? 'active' : ''}" type="button" aria-pressed="${active}" data-site-tab="${escapeHtml(site)}">${escapeHtml(labels[site] || site)}</button>`;
      })
    ].join('');
  }
  const idleDescription = $('#idle-description');
  if (idleDescription) idleDescription.textContent = countryProfile?.idleText || profile.idleText;
  const keyword = $('#keyword');
  if (keyword) keyword.placeholder = 'Search by product, brand, or model (e.g. iPhone 13)';
  const brand = $('.brand');
  if (brand) brand.href = `/global/?country=${state.activeCountry}`;
  document.title = 'Global Used Listings Search | USED MARKET';
  document.documentElement.dataset.marketProfile = 'global';
  document.documentElement.dataset.marketCountry = state.activeCountry;
}

function updateExternalSearchLinks() {}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function defaultCurrency() {
  return state.activeCountry === 'jp' ? 'JPY' : 'USD';
}

function formatPrice(value, currency = defaultCurrency()) {
  if (currency === 'MIXED') return 'Mixed currencies';
  if (typeof value !== 'number') return 'Price unavailable';
  const normalizedCurrency = String(currency || defaultCurrency()).toUpperCase();
  const locale = { KRW: 'ko-KR', JPY: 'ja-JP', USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', SGD: 'en-SG' }[normalizedCurrency] || 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: ['KRW', 'JPY'].includes(normalizedCurrency) ? 0 : 2
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} ${normalizedCurrency}`;
  }
}

function resultCurrency(data = state.data) {
  const items = Array.isArray(data) ? data : data?.items || [];
  const currencies = new Set(items
    .map((item) => String(item.currency || '').trim().toUpperCase())
    .filter(Boolean));
  if (currencies.size === 1) return currencies.values().next().value;
  if (currencies.size > 1) return 'MIXED';
  return defaultCurrency();
}

function activeCollectionItems() {
  const items = state.data?.items || [];
  return state.activeSite === 'all' ? items : items.filter((item) => item.site === state.activeSite);
}

function hasAbsoluteListingDate(item) {
  if (item?.site === 'yahoo_auction_jp') return false;
  const timestamp = Date.parse(String(item?.posted_at || ''));
  return Number.isFinite(timestamp);
}

function controlNoticeText() {
  if (!state.data) return '';
  const sortMeta = state.data.sort_meta || {};
  const filterMeta = state.data.filter_meta || {};
  const mixedCurrency = resultCurrency(activeCollectionItems()) === 'MIXED';
  if (state.activeSite === 'all' && filterMeta.reason === 'mixed_currency') {
    return 'The price range was not applied because the results use multiple currencies. Select one marketplace and try again.';
  }
  if (sortMeta.reason === 'mixed_currency' || mixedCurrency) {
    return 'These results use multiple currencies. Select one marketplace to sort or filter by price.';
  }
  if (['no_valid_dates', 'missing_dates'].includes(sortMeta.reason)) {
    return 'Newest was not applied because listing dates are unavailable.';
  }
  if (sortMeta.reason === 'no_comparable_prices') {
    return 'Price sorting was not applied because comparable prices are unavailable.';
  }
  return '';
}

function renderControlNotice() {
  const root = $('#control-notice');
  if (!root) return;
  const message = controlNoticeText();
  root.textContent = message;
  root.hidden = !message;
}

function updateResultControls() {
  const items = activeCollectionItems();
  const currency = resultCurrency(items);
  const mixedCurrency = Boolean(state.data && currency === 'MIXED');
  const hasDates = items.some(hasAbsoluteListingDate);
  $$('#sort-tabs [data-sort]').forEach((control) => {
    const sort = control.dataset.sort;
    const unavailable = (['price_asc', 'price_desc'].includes(sort) && mixedCurrency)
      || (sort === 'recent' && Boolean(state.data) && !hasDates);
    control.disabled = state.loading || unavailable;
    control.title = unavailable
      ? sort === 'recent'
        ? 'No listings include a usable date.'
        : 'Select one marketplace before sorting results that use multiple currencies.'
      : '';
  });
  ['#min-price', '#max-price', '#apply-price-filter'].forEach((selector) => {
    const control = $(selector);
    if (control) control.disabled = state.loading || mixedCurrency;
  });
  const reset = $('#reset-filters');
  if (reset) reset.disabled = state.loading;
  const priceStep = ['USD', 'EUR', 'GBP', 'SGD'].includes(currency) ? '0.01' : '1';
  const currencyHint = currency === 'MIXED' ? 'Mixed' : currency;
  const minInput = $('#min-price');
  const maxInput = $('#max-price');
  if (minInput) {
    minInput.step = priceStep;
    minInput.placeholder = 'Minimum price';
  }
  if (maxInput) {
    maxInput.step = priceStep;
    maxInput.placeholder = 'Maximum price';
  }
}

function formatNoiseReason(value) {
  const reasons = {
    guide_or_advertisement: 'Guide or promotional listing',
    placeholder_price: 'Price needs verification',
    bundled_part_offer: 'Bundle details need verification',
    part_build_leak: 'Parts configuration needs verification'
  };
  return reasons[String(value || '')] || 'Excluded reference';
}

function formatPostedAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Date unavailable';
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  const elapsed = Math.max(0, Date.now() - date.getTime());
  if (elapsed < 60 * 1000) return 'Just now';
  if (elapsed < 60 * 60 * 1000) return `${Math.floor(elapsed / (60 * 1000))} min ago`;
  if (elapsed < 24 * 60 * 60 * 1000) return `${Math.floor(elapsed / (60 * 60 * 1000))} hr ago`;
  if (elapsed < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(elapsed / (24 * 60 * 60 * 1000));
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function formatCondition(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  if (/for parts|not working|no power/.test(normalized)) return 'For parts / Not working';
  if (/locked|restricted/.test(normalized)) return 'Locked / Restricted';
  if (/demo|display unit/.test(normalized)) return 'Demo / Display unit';
  if (/new without tags/.test(normalized)) return 'New without tags';
  if (/like new/.test(normalized)) return 'Like new';
  if (/near mint/.test(normalized)) return raw;
  if (/excellent/.test(normalized)) return 'Excellent';
  if (/very good/.test(normalized)) return 'Very good';
  if (/satisfactory/.test(normalized)) return 'Satisfactory';
  if (/\bfair\b/.test(normalized)) return 'Fair';
  if (/\bgood\b/.test(normalized)) return 'Good';
  return raw;
}

function formatShipping(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(free_shipping|free shipping)$/i.test(raw)) return 'Free Shipping';
  if (/送料未定/.test(raw)) return 'Shipping TBD';
  const yen = raw.match(/送料\s*([\d,]+)\s*円/i);
  if (yen) return `Shipping ¥${yen[1]}`;
  return raw;
}

function formatListingTime(item) {
  const raw = String(item?.posted_at || '').trim();
  if (item?.site === 'yahoo_auction_jp' && raw) {
    const day = raw.match(/(\d+)\s*日/);
    if (day) return `Ends in ${day[1]} ${Number(day[1]) === 1 ? 'day' : 'days'}`;
    const hour = raw.match(/(\d+)\s*時間/);
    if (hour) return `Ends in ${hour[1]} ${Number(hour[1]) === 1 ? 'hour' : 'hours'}`;
    const minute = raw.match(/(\d+)\s*分/);
    if (minute) return `Ends in ${minute[1]} ${Number(minute[1]) === 1 ? 'minute' : 'minutes'}`;
    if (/終了|ended/i.test(raw)) return 'Auction ended';
  }
  return formatPostedAt(raw);
}

function formatMarketComparison(item) {
  if (item.price_suspect) return 'Price needs verification';
  if (item.site === 'yahoo_auction_jp' || /입찰|bid/i.test(String(item.price_label || ''))) return 'Final price may change';
  const rate = Number(item.deviation_rate);
  if (!Number.isFinite(rate) || rate === 0) return '';
  return rate > 0
    ? `${Math.round(rate * 100)}% below market`
    : `${Math.round(Math.abs(rate) * 100)}% above market`;
}

function formatPriceLabel(value) {
  const raw = String(value || '').trim();
  if (/^(판매가|sale price|listing price)$/i.test(raw)) return 'Sale price';
  if (/^(현재 입찰가|current bid)$/i.test(raw)) return 'Current bid';
  return raw;
}

function formatCheckedAge(freshness) {
  let seconds = Number(freshness?.age_seconds);
  if (!Number.isFinite(seconds) && freshness?.refreshed_at) {
    seconds = Math.max(0, Math.floor((Date.now() - Date.parse(freshness.refreshed_at)) / 1000));
  }
  if (!Number.isFinite(seconds) || seconds < 60) return 'Checked just now';
  if (seconds < 60 * 60) return `Checked ${Math.floor(seconds / 60)} min ago`;
  if (seconds < 24 * 60 * 60) return `Checked ${Math.floor(seconds / (60 * 60))} hr ago`;
  const days = Math.floor(seconds / (24 * 60 * 60));
  return `Checked ${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function originalLanguageAttr(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || '')) ? ' lang="ja"' : '';
}

function loadFavorites() {
  try {
    const values = JSON.parse(localStorage.getItem(storageKey('used-market:favorites')) || '[]');
    return new Set(Array.isArray(values) ? values.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(storageKey('used-market:favorites'), JSON.stringify(Array.from(state.favorites)));
  } catch {
    // 찜 저장이 막힌 브라우저에서도 검색 결과는 계속 사용할 수 있다.
  }
}

function loadFavoriteItems() {
  try {
    const values = JSON.parse(localStorage.getItem(storageKey('used-market:favorite-items')) || '[]');
    if (!Array.isArray(values)) return new Map();
    return new Map(values
      .filter((item) => item && typeof item === 'object' && (item.url || item.id))
      .map((item) => [favoriteKey(item), item]));
  } catch {
    return new Map();
  }
}

function saveFavoriteItems() {
  try {
    localStorage.setItem(storageKey('used-market:favorite-items'), JSON.stringify(Array.from(state.favoriteItems.values()).slice(-200)));
  } catch {
    // 스냅샷 저장이 막힌 브라우저에서도 하트 상태는 유지한다.
  }
}

function loadRecentItems() {
  try {
    const values = JSON.parse(localStorage.getItem(storageKey('used-market:recent-items')) || '[]');
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values
      .filter((item) => item && typeof item === 'object' && (item.url || item.id))
      .filter((item) => {
        const key = favoriteKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

function saveRecentItems() {
  try {
    localStorage.setItem(storageKey('used-market:recent-items'), JSON.stringify(state.recentItems.slice(0, 6)));
  } catch {
    // 브라우저 저장 공간이 없으면 이번 세션에서만 최근 목록을 유지합니다.
  }
}

function loadRecentSearches() {
  try {
    const values = JSON.parse(localStorage.getItem(storageKey('used-market:recent-searches')) || '[]');
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)))
      .slice(0, 6);
  } catch {
    return [];
  }
}

function saveRecentSearches() {
  try {
    localStorage.setItem(storageKey('used-market:recent-searches'), JSON.stringify(state.recentSearches.slice(0, 6)));
  } catch {
    // 저장 공간을 사용할 수 없어도 검색 자체는 계속할 수 있습니다.
  }
}

function recordRecentSearch(keyword) {
  const value = String(keyword || '').trim();
  if (!value) return;
  state.recentSearches = [value, ...state.recentSearches.filter((candidate) => candidate.toLowerCase() !== value.toLowerCase())].slice(0, 6);
  saveRecentSearches();
  renderRecentSearches();
}

function renderRecentSearches() {
  const root = $('#recent-search-list');
  const clearButton = $('#clear-recent-searches');
  const panel = root?.closest('.recent-searches');
  if (!root || !clearButton) return;
  clearButton.hidden = !state.recentSearches.length;
  panel?.classList.toggle('has-items', Boolean(state.recentSearches.length));
  if (!state.recentSearches.length) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML = state.recentSearches.map((keyword) => `<button type="button" class="recent-search-button" data-recent-search="${escapeHtml(keyword)}">${escapeHtml(keyword)}</button>`).join('');
}

function favoriteKey(item) {
  return String(item.url || item.id || `${item.site || 'item'}:${item.title || ''}`);
}

function recordRecentItem(item) {
  const listingUrl = safeListingUrl(item);
  if (!item || !(listingUrl || item.id)) return;
  const snapshot = {
    id: item.id,
    url: listingUrl,
    title: item.title || 'Untitled listing',
    price: item.price,
    currency: item.currency || defaultCurrency(),
    image_url: safeImageUrl(item.image_url),
    site: item.site
  };
  const key = favoriteKey(snapshot);
  state.recentItems = [snapshot, ...state.recentItems.filter((candidate) => favoriteKey(candidate) !== key)].slice(0, 6);
  saveRecentItems();
  renderRecentViewed();
}

function reloadRecentItems() {
  state.recentItems = loadRecentItems();
  renderRecentViewed();
}

function renderRecentViewed() {
  const root = $('#recent-viewed-list');
  if (!root) return;
  if (!state.recentItems.length) {
    root.innerHTML = `<div class="recent-viewed-empty"><span class="recent-viewed-empty-icon" aria-hidden="true">⌕</span><p>${'No recently viewed items.'}</p></div>`;
    return;
  }
  root.innerHTML = state.recentItems.map((item) => {
    const imageUrl = safeImageUrl(item.image_url);
    const listingUrl = safeListingUrl(item);
    const title = escapeHtml(item.title || 'Untitled listing');
    const key = escapeHtml(favoriteKey(item));
    const image = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false;" /><span class="recent-viewed-thumb-fallback" hidden>${'Image unavailable'}</span>`
      : `<span class="recent-viewed-thumb-fallback">${'Image unavailable'}</span>`;
    const content = `<span class="recent-viewed-thumb">${image}</span><span class="recent-viewed-copy"><strong${originalLanguageAttr(item.title)}>${title}</strong><small>${escapeHtml(formatPrice(item.price, item.currency))}</small></span>`;
    return listingUrl
      ? `<a class="recent-viewed-item" href="${escapeHtml(listingUrl)}" target="_blank" rel="noreferrer noopener" data-recent-key="${key}">${content}</a>`
      : `<div class="recent-viewed-item" data-recent-key="${key}">${content}</div>`;
  }).join('');
}

function updateSortTabs() {
  $$('#sort-tabs [data-sort]').forEach((tab) => {
    const active = tab.dataset.sort === state.sort;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
}

function toggleFavorite(button) {
  const key = button.dataset.favorite;
  if (!key) return;
  const item = (state.data?.items || []).find((candidate) => favoriteKey(candidate) === key);
  if (state.favorites.has(key)) {
    state.favorites.delete(key);
    state.favoriteItems.delete(key);
  } else {
    state.favorites.add(key);
    if (item) state.favoriteItems.set(key, { ...item });
  }
  saveFavorites();
  saveFavoriteItems();
  const saved = state.favorites.has(key);
  button.classList.toggle('saved', saved);
  button.setAttribute('aria-pressed', String(saved));
  button.setAttribute('aria-label', saved ? 'Remove saved item' : 'Save item');
  button.textContent = saved ? '♥' : '♡';
  if (state.showFavorites) renderResults();
}

function selectedCategoryIds() {
  if (state.categoryIds.length) return [...state.categoryIds];
  return state.categoryId !== 'all' ? [state.categoryId] : [];
}

function categoryParentId(categoryId) {
  return (state.categories.find((category) => category.id === categoryId)
    || fallbackCategories.find((category) => category.id === categoryId))?.parentId || null;
}

function isCategoryAncestor(ancestorId, categoryId) {
  let parentId = categoryParentId(categoryId);
  while (parentId) {
    if (parentId === ancestorId) return true;
    parentId = categoryParentId(parentId);
  }
  return false;
}

function categoryPlanFor(site, categoryId) {
  return state.sitePlans?.[site]?.[categoryId] || null;
}

function categorySelectableForSite(site, categoryId) {
  if (categoryId === 'all') return true;
  if (state.categoryCatalogStatus !== 'ready') return true;
  if (!Object.keys(state.sitePlans || {}).length) return true;
  if (site === 'all') return DEFAULT_SITES.some((candidate) => categorySelectableForSite(candidate, categoryId));
  return categoryPlanFor(site, categoryId)?.selectable === true;
}

function categorySelectable(categoryId) {
  if (categoryId === 'all') return true;
  const sites = state.activeSite === 'all' ? DEFAULT_SITES : [state.activeSite];
  const hasExplicitKeyword = Boolean(state.query || $('#keyword')?.value.trim());
  return sites.some((site) => (
    categorySelectableForSite(site, categoryId)
    || (hasExplicitKeyword && SEARCH_ONLY_SITES.has(site))
  ));
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 700px)').matches;
}

function selectedCategorySummary() {
  const ids = selectedCategoryIds();
  if (!ids.length) return 'All';
  const names = ids
    .map((id) => (state.categories.find((category) => category.id === id) || fallbackCategories.find((category) => category.id === id))?.label)
    .filter(Boolean);
  if (names.length <= 1) return names[0] || 'All';
  return `${names[0]} +${names.length - 1}`;
}

function syncCategoryPanel() {
  const sidebar = $('.category-sidebar');
  const toggle = $('#category-panel-toggle');
  const list = $('#category-list');
  if (!sidebar || !toggle || !list) return;
  const mobile = isMobileViewport();
  const open = mobile ? state.categoryPanelOpen : true;
  sidebar.classList.toggle('is-collapsed', mobile && !open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Hide categories' : 'Show categories');
  list.setAttribute('aria-hidden', String(mobile && !open));
  $('#category-summary').textContent = selectedCategorySummary();
}

function getSelectedSites(categoryIds = selectedCategoryIds(), keyword = state.query) {
  const sites = state.activeSite === 'all' ? DEFAULT_SITES : [state.activeSite];
  if (!categoryIds.length) return sites;
  const hasExplicitKeyword = Boolean(String(keyword || '').trim());
  return sites.filter((site) => (
    categoryIds.every((categoryId) => categorySelectableForSite(site, categoryId))
    || (hasExplicitKeyword && SEARCH_ONLY_SITES.has(site))
  ));
}

function renderCategories() {
  const root = $('#category-list');
  if (root) root.innerHTML = '';
}

async function loadCategories() {
  try {
    const response = await fetch(`${API_BASE_PATH}/categories`);
    const payload = await response.json();
    const categories = payload?.data?.categories;
    if (response.ok && payload.status === 'success' && Array.isArray(categories) && categories.length) {
      state.categories = categories;
      state.sitePlans = payload?.data?.site_plans || {};
      state.categoryCatalogStatus = 'ready';
    } else {
      state.categoryCatalogStatus = 'unavailable';
    }
  } catch {
    state.categoryCatalogStatus = 'unavailable';
    // API가 늦거나 없는 환경에서도 기본 카테고리 rail을 먼저 보여준다.
  }
  renderCategories();
}

function cancelPendingSearch() {
  state.requestController?.abort();
  state.requestController = null;
  cancelRefreshTracking();
  if (state.loading) setLoading(false);
}

function cancelRefreshTracking({ keepMessage = false } = {}) {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = null;
  state.refreshToken = '';
  state.refreshAttempt = 0;
  state.refreshFingerprint = '';
  state.pendingRefreshData = null;
  state.pendingResultKind = '';
  if (!keepMessage) state.refreshMessage = '';
}

function makeSearchFingerprint({ keyword, categoryIds, sites }) {
  return JSON.stringify({
    keyword: String(keyword || '').trim().toLowerCase(),
    categoryIds: [...categoryIds].sort(),
    sites: [...sites].sort(),
    sort: state.sort,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice
  });
}

function renderFreshnessStatus() {
  const root = $('#freshness-status');
  const message = $('#freshness-message');
  const button = $('#apply-refresh-results');
  if (!root || !message || !button) return;
  const freshness = state.data?.freshness;
  if (!freshness && !state.refreshMessage) {
    root.hidden = true;
    root.classList.remove('is-checking');
    button.hidden = true;
    return;
  }
  const checking = Boolean(state.refreshToken);
  const base = formatCheckedAge(freshness);
  message.textContent = state.refreshMessage || (checking ? `${base} · ${'Checking for new listings'}` : base);
  root.hidden = false;
  root.classList.toggle('is-checking', checking);
  button.hidden = !state.pendingRefreshData;
  if (state.pendingRefreshData) {
    if (state.pendingResultKind === 'stale') {
      button.textContent = 'View saved results';
    } else {
      const added = Math.max(0, Number(state.pendingRefreshData?.refresh?.added_count) || 0);
      button.textContent = added > 0
        ? `View ${added} new ${added === 1 ? 'listing' : 'listings'}`
        : 'View update';
    }
  }
}

function scheduleRefreshPoll() {
  const delays = [2_000, 5_000, 10_000];
  if (!state.refreshToken) return;
  if (state.refreshAttempt >= delays.length) {
    state.refreshToken = '';
    state.refreshTimer = null;
    state.refreshMessage = `${formatCheckedAge(state.data?.freshness)} · ${'Update delayed'}`;
    renderFreshnessStatus();
    return;
  }
  const delay = delays[state.refreshAttempt];
  state.refreshAttempt += 1;
  state.refreshTimer = setTimeout(() => { void pollRefreshResult(); }, delay);
}

async function pollRefreshResult() {
  const token = state.refreshToken;
  const fingerprint = state.refreshFingerprint;
  if (!token || !fingerprint) return;
  try {
    const response = await fetch(`${API_BASE_PATH}/search/refresh/${encodeURIComponent(token)}`);
    const payload = await response.json();
    if (token !== state.refreshToken || fingerprint !== state.refreshFingerprint) return;
    if (response.status === 202) {
      scheduleRefreshPoll();
      return;
    }
    if (!response.ok || payload.status !== 'success' || !payload.data?.items) {
      state.refreshToken = '';
      state.refreshMessage = `${formatCheckedAge(state.data?.freshness)} · ${'Update delayed'}`;
      renderFreshnessStatus();
      return;
    }
    const refreshedData = acceptRefreshPayload(payload.data, { assign: state.currentPage === 0 });
    if (!refreshedData) return;
    const added = Math.max(0, Number(refreshedData.refresh?.added_count) || 0);
    state.refreshToken = '';
    state.refreshTimer = null;
    state.refreshMessage = added > 0
      ? `Checked just now · ${added} new ${added === 1 ? 'listing' : 'listings'}`
      : 'Checked just now · No new listings';
    if (state.currentPage === 0) {
      state.pendingRefreshData = null;
      state.pendingResultKind = '';
      renderAll();
    } else {
      state.pendingRefreshData = refreshedData;
      state.pendingResultKind = 'refresh';
      renderFreshnessStatus();
    }
  } catch {
    if (token === state.refreshToken && fingerprint === state.refreshFingerprint) scheduleRefreshPoll();
  }
}

function trackSearchRefresh(data, fingerprint) {
  if (state.refreshTimer) clearTimeout(state.refreshTimer);
  state.refreshTimer = null;
  state.refreshAttempt = 0;
  state.pendingRefreshData = null;
  state.pendingResultKind = '';
  state.refreshMessage = '';
  if (data?.stale_fallback?.items?.length) {
    state.pendingRefreshData = data.stale_fallback;
    state.pendingResultKind = 'stale';
    state.refreshMessage = `Marketplace check failed · Showing results ${formatCheckedAge(data.stale_fallback.freshness).toLowerCase()}`;
  }
  const token = String(data?.freshness?.refresh_token || data?.refresh?.token || '').trim();
  const refreshState = String(data?.freshness?.refresh_state || data?.refresh?.state || '');
  state.refreshToken = ['queued', 'running'].includes(refreshState) ? token : '';
  state.refreshFingerprint = state.refreshToken ? fingerprint : '';
  if (state.refreshToken) scheduleRefreshPoll();
  renderFreshnessStatus();
}

function activeViewSites(site = state.activeSite) {
  return site === 'all' ? [] : [site];
}

function sessionViewKey(site = state.activeSite) {
  return JSON.stringify({ site, sort: state.sort, minPrice: state.minPrice, maxPrice: state.maxPrice });
}

function finiteSessionCount(value, fallback = 0) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : fallback;
}

function sessionInfo(data = state.data) {
  const nested = data?.session && typeof data.session === 'object' ? data.session : null;
  const id = String(nested?.id || data?.session_id || '').trim();
  if (!id) return null;
  const sourceTotalsValue = nested?.source_totals || data?.source_totals;
  const sourceTotals = sourceTotalsValue && typeof sourceTotalsValue === 'object'
    ? Object.fromEntries(Object.entries(sourceTotalsValue).map(([site, count]) => [site, finiteSessionCount(count)]))
    : {};
  const generationValue = Number(nested?.generation ?? data?.session_generation);
  const pageValue = Number(nested?.page ?? data?.session_page);
  const loadedCount = finiteSessionCount(nested?.loaded_count, Array.isArray(data?.items) ? data.items.length : 0);
  const availableCount = finiteSessionCount(nested?.available_count, loadedCount);
  const windowCount = finiteSessionCount(nested?.window, Math.max(RESULT_PAGE_SIZE, loadedCount));
  return {
    ...nested,
    id,
    generation: Number.isInteger(generationValue) && generationValue >= 0 ? generationValue : null,
    page: Number.isInteger(pageValue) && pageValue >= 0 ? pageValue : 0,
    page_size: RESULT_PAGE_SIZE,
    loaded_count: Math.min(loadedCount, SEARCH_SESSION_MAX_ITEMS),
    available_count: Math.min(availableCount, SEARCH_SESSION_MAX_ITEMS),
    window: Math.min(Math.max(RESULT_PAGE_SIZE, windowCount), SEARCH_SESSION_MAX_ITEMS),
    source_totals: sourceTotals,
    expires_at: nested?.expires_at || data?.session_expires_at || null
  };
}

function normalizeSessionPageData(data, { viewKey = sessionViewKey(), preview = false } = {}) {
  const session = sessionInfo(data);
  if (!session) return data;
  const items = Array.isArray(data?.items) ? data.items.slice(0, RESULT_PAGE_SIZE) : [];
  const sources = (data?.sources || []).map((source) => {
    const total = session.source_totals[source.key];
    return Number.isFinite(total) ? { ...source, total_count: total, visible_count: total } : source;
  });
  return {
    ...data,
    items,
    sources,
    session,
    quality: {
      ...(data?.quality || {}),
      returned_count: items.length,
      available_count: session.available_count,
      page_limit: RESULT_PAGE_SIZE
    },
    _session_page_data: !preview,
    _session_preview: preview,
    _session_view_key: viewKey
  };
}

function adoptSessionData(data, options = {}) {
  const normalized = normalizeSessionPageData(data, options);
  const session = sessionInfo(normalized);
  if (!session) return normalized;
  if (state.sessionId && session.id !== state.sessionId) return null;
  if (state.sessionId === session.id
    && Number.isInteger(state.sessionGeneration)
    && Number.isInteger(session.generation)
    && session.generation < state.sessionGeneration) return null;
  state.sessionId = session.id;
  state.sessionGeneration = session.generation;
  state.sessionWindow = session.window;
  return normalized;
}

function acceptRefreshPayload(data, { assign = false } = {}) {
  const hasSession = Boolean(sessionInfo(data));
  const accepted = hasSession ? adoptSessionData(data, { viewKey: sessionViewKey() }) : data;
  if (!accepted) return null;
  if (assign) {
    if (!hasSession) clearSearchSession();
    state.data = accepted;
    if (hasSession) rememberViewData(accepted);
  }
  return accepted;
}

function clearSearchSession() {
  state.sessionId = null;
  state.sessionGeneration = null;
  state.sessionWindow = null;
  state.sessionViewPending = false;
  state.collectionSites = [];
  state.collectionData = null;
  state.viewData = new Map();
  state.focusedSiteWindows = {};
}

function rememberViewData(data) {
  if (!data) return;
  state.viewData.set(sessionViewKey(), data);
  if (state.activeSite === 'all') state.collectionData = data;
}

function previewDataForSite(site) {
  const key = sessionViewKey(site);
  const cached = state.viewData.get(key);
  const base = cached || state.collectionData;
  if (!base) return null;
  if (cached || site === 'all') return normalizeSessionPageData(base, { viewKey: key, preview: true });
  const baseSession = sessionInfo(base);
  const items = (base.items || []).filter((item) => item.site === site).slice(0, RESULT_PAGE_SIZE);
  const sourceTotal = baseSession?.source_totals?.[site] ?? items.length;
  return normalizeSessionPageData({
    ...base,
    items,
    sources: (base.sources || []).filter((source) => source.key === site),
    session: baseSession ? {
      ...baseSession,
      page: 0,
      available_count: sourceTotal,
      source_totals: { [site]: sourceTotal }
    } : null,
    quality: {
      ...(base.quality || {}),
      returned_count: items.length,
      available_count: sourceTotal
    }
  }, { viewKey: key, preview: true });
}

async function loadSessionView({ page = 0, site = state.activeSite, sessionOnly = true } = {}) {
  if (!state.sessionId || state.loading) return false;
  const requestController = new AbortController();
  state.requestController?.abort();
  state.requestController = requestController;
  const requestedSessionId = state.sessionId;
  const requestedGeneration = state.sessionGeneration;
  const requestedViewKey = sessionViewKey(site);
  const categoryIds = selectedCategoryIds();
  const sites = state.collectionSites.length ? [...state.collectionSites] : getSelectedSites(categoryIds, state.query);
  state.sessionViewPending = true;
  state.appendError = '';
  setLoading(true, true);
  try {
    const data = await requestSearchPage({
      keyword: state.query,
      categoryIds,
      sites,
      viewSites: activeViewSites(site),
      sessionId: requestedSessionId,
      sessionGeneration: requestedGeneration,
      sessionPage: page,
      sessionOnly,
      sessionWindow: state.sessionWindow,
      signal: requestController.signal,
      refreshIndex: false
    });
    if (state.requestController !== requestController
      || state.sessionId !== requestedSessionId
      || sessionViewKey(site) !== requestedViewKey) return false;
    const accepted = adoptSessionData(data, { viewKey: requestedViewKey });
    if (!accepted || !sessionInfo(accepted)) return false;
    state.data = accepted;
    state.currentPage = sessionInfo(accepted)?.page ?? page;
    rememberViewData(accepted);
    return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    state.appendError = formatSourceMessage(error.message);
    $('#search-status').textContent = `Could not update this result view: ${state.appendError}`;
    $('#search-status').classList.add('visible');
    return false;
  } finally {
    if (state.requestController === requestController) {
      state.requestController = null;
      state.sessionViewPending = false;
      setLoading(false);
      renderAll();
    }
  }
}

async function refreshSessionView() {
  if (!state.sessionId) return false;
  return loadSessionView({ page: 0, site: state.activeSite, sessionOnly: true });
}

async function setActiveSite(site) {
  const enteringMixedJapanAggregate = state.activeCountry === 'jp'
    && site === 'all';
  if (enteringMixedJapanAggregate) {
    state.sort = 'recommended';
    state.minPrice = null;
    state.maxPrice = null;
    $('#min-price').value = '';
    $('#max-price').value = '';
    updateSortTabs();
  }
  state.activeSite = site;
  state.showFavorites = false;
  $$('.site-tabs [data-site-tab]').forEach((tab) => {
    const active = tab.dataset.siteTab === site;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
  renderCategories();
  const selected = selectedCategoryIds();
  if (selected.length) {
    const keywordFallback = Boolean(state.query) && SEARCH_ONLY_SITES.has(site);
    const compatible = selected.filter((categoryId) => keywordFallback || categorySelectableForSite(site, categoryId));
    const removed = selected.filter((categoryId) => !compatible.includes(categoryId));
    if (removed.length > 0) {
      state.categoryIds = compatible;
      state.categoryId = compatible.length === 1 ? compatible[0] : 'all';
      renderCategories();
      const removedLabels = removed
        .map((categoryId) => (state.categories.find((category) => category.id === categoryId) || fallbackCategories.find((category) => category.id === categoryId))?.label)
        .filter(Boolean);
      $('#search-status').textContent = `Excluded unavailable categories for ${labels[site] || site}: ${removedLabels.join(', ')}.`;
      $('#search-status').classList.add('visible');
      if (!compatible.length && !state.query) {
        showUnavailableSelection(removed[0]);
        return;
      }
    }
  }
  const compatibleSelected = selectedCategoryIds();
  if (state.sessionId && state.data) {
    const preview = previewDataForSite(site);
    if (preview) {
      state.data = preview;
      state.currentPage = 0;
      state.appendError = '';
      renderAll();
    }
    await loadSessionView({ page: 0, site, sessionOnly: true });
    return;
  }
  const loadedSourceKeys = new Set((state.data?.sources || []).map((source) => source.key));
  const requestedSourceKeys = site === 'all' ? GLOBAL_MARKET.countries[state.activeCountry].sites : [site];
  if (state.data && requestedSourceKeys.every((sourceKey) => loadedSourceKeys.has(sourceKey))) {
    state.currentPage = 0;
    state.appendError = '';
    renderAll();
    return;
  }
  if (state.query || compatibleSelected.length) {
    executeSearch({ keyword: state.query, categoryIds: compatibleSelected });
    return;
  }
  state.data = null;
  $('.market-app').classList.remove('has-results');
  resetRenderedResultSummary();
  hidePagination();
  $('#result-list').innerHTML = '<div class="empty-state" aria-hidden="true"></div>';
}

function setActiveCountry(country) {
  if (!GLOBAL_MARKET.countries[country] || state.activeCountry === country) return;
  state.activeCountry = country;
  state.activeSite = 'all';
  state.sort = 'recommended';
  state.minPrice = null;
  state.maxPrice = null;
  state.showFavorites = false;
  state.data = null;
  clearSearchSession();
  $('#min-price').value = '';
  $('#max-price').value = '';
  updateSortTabs();
  const url = new URL(window.location.href);
  url.pathname = '/global/';
  url.searchParams.delete('market');
  url.searchParams.set('country', country);
  window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  renderMarketProfile();
  setActiveSite('all');
}

function setCategory(categoryId) {
  const nextCategoryId = categoryId || 'all';
  if (nextCategoryId === 'all') {
    state.categoryIds = [];
    state.categoryId = 'all';
    state.showFavorites = false;
    state.categoryPanelOpen = false;
    cancelPendingSearch();
    state.query = '';
    $('#keyword').value = '';
    state.data = null;
    renderCategories();
    renderSourceSummary();
    $('.market-app').classList.remove('has-results');
    resetRenderedResultSummary();
    hidePagination();
    $('#result-list').innerHTML = '<div class="empty-state" aria-hidden="true"></div>';
    return;
  }
  if (!categorySelectable(nextCategoryId)) {
    showUnavailableSelection(nextCategoryId);
    return;
  }
  const current = selectedCategoryIds();
  const next = current.includes(nextCategoryId)
    ? current.filter((categoryId) => categoryId !== nextCategoryId)
    : [
        ...current.filter((categoryId) => (
          categoryId !== nextCategoryId
          && !isCategoryAncestor(categoryId, nextCategoryId)
          && !isCategoryAncestor(nextCategoryId, categoryId)
        )),
        nextCategoryId
      ];
  state.categoryIds = next;
  state.categoryId = next.length === 1 ? next[0] : 'all';
  state.showFavorites = false;
  state.categoryPanelOpen = false;
  renderCategories();
  if (!next.length) {
    cancelPendingSearch();
    if ($('#keyword').value.trim()) {
      executeSearch({ keyword: $('#keyword').value.trim(), categoryIds: [] });
    } else {
      state.query = '';
      state.data = null;
      renderSourceSummary();
      $('.market-app').classList.remove('has-results');
      resetRenderedResultSummary();
      hidePagination();
      $('#result-list').innerHTML = '<div class="empty-state" aria-hidden="true"></div>';
    }
    return;
  }
  executeSearch({ keyword: $('#keyword').value.trim(), categoryIds: state.categoryIds });
}

function showUnavailableSelection(categoryId = '') {
  cancelPendingSearch();
  state.data = null;
  renderSourceSummary();
  state.showFavorites = false;
  const categoryLabel = categoryId
    ? (state.categories.find((category) => category.id === categoryId) || fallbackCategories.find((category) => category.id === categoryId))?.label
    : selectedCategoryIds().map((id) => (state.categories.find((category) => category.id === id) || fallbackCategories.find((category) => category.id === id))?.label).filter(Boolean).join(', ');
  $('#search-status').textContent = `The selected category is unavailable on ${labels[state.activeSite] || state.activeSite}.`;
  $('#search-status').classList.add('visible');
  resetRenderedResultSummary();
  $('#result-list').innerHTML = `<div class="empty-state" role="status"><span>${'Category unavailable'}</span></div>`;
  hidePagination();
  $('.market-app').classList.add('has-results');
}

function resetRenderedResultSummary() {
  $('#result-count').textContent = '0 results';
  state.priceFilterIgnored = false;
  state.priceFilterCurrency = defaultCurrency();
  cancelRefreshTracking();
  renderFreshnessStatus();
  renderControlNotice();
  updateResultControls();
}

function hidePagination() {
  const pagination = $('#pagination-controls');
  if (!pagination) return;
  pagination.hidden = true;
  pagination.innerHTML = '';
}

function syncPriceRangeFromInputs() {
  const minInput = $('#min-price');
  const maxInput = $('#max-price');
  const parseInput = (input) => {
    if (!input.value.trim()) return null;
    const value = Number(input.value);
    return Number.isFinite(value) && value >= 0 && value <= 100_000_000_000
      ? value
      : Number.NaN;
  };
  const minPrice = parseInput(minInput);
  const maxPrice = parseInput(maxInput);
  const invalid = Number.isNaN(minPrice) || Number.isNaN(maxPrice)
    || (minPrice !== null && maxPrice !== null && minPrice > maxPrice);
  minInput.toggleAttribute('aria-invalid', invalid);
  maxInput.toggleAttribute('aria-invalid', invalid);
  if (invalid) {
    $('#search-status').textContent = 'Check the price range.';
    $('#search-status').classList.add('visible');
    return false;
  }
  state.minPrice = minPrice;
  state.maxPrice = maxPrice;
  return true;
}

function setLoading(loading, pageChange = false) {
  state.loading = loading;
  $('.market-app').classList.toggle('is-loading', loading && !pageChange);
  const button = $('#search-button');
  $('.results-section').setAttribute('aria-busy', String(loading));
  button.disabled = loading;
  button.querySelector('span').textContent = loading && !pageChange ? 'Searching' : 'Search';
  updateResultControls();
  $$('#pagination-controls button').forEach((pageButton) => {
    pageButton.disabled = loading || pageButton.dataset.resultPage === String(state.currentPage);
  });
  if (loading && !pageChange) {
    $('#result-list').innerHTML = `<div class="loading-state"><div class="loading-ring"></div><strong>${'Searching'}</strong></div>`;
  }
}

async function requestSearchPage({
  keyword,
  categoryIds,
  sites,
  viewSites = activeViewSites(),
  cursor = null,
  sessionId = state.sessionId,
  sessionGeneration = state.sessionGeneration,
  sessionPage = null,
  sessionOnly = false,
  sessionWindow = state.sessionWindow,
  signal,
  refreshIndex = false,
  siteWindow = state.siteWindow,
  expandIndex = false
}) {
  const response = await fetch(`${API_BASE_PATH}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      keyword,
      category_id: categoryIds.length === 1 ? categoryIds[0] : undefined,
      category_ids: categoryIds.length > 1 ? categoryIds : undefined,
      sites,
      view_sites: viewSites.length ? viewSites : undefined,
      sort: state.sort,
      min_price: state.minPrice ?? undefined,
      max_price: state.maxPrice ?? undefined,
      limit: RESULT_PAGE_SIZE,
      site_window: undefined,
      refresh_index: refreshIndex,
      expand_index: undefined,
      session_id: sessionId || undefined,
      session_generation: Number.isInteger(sessionGeneration) ? sessionGeneration : undefined,
      session_page: Number.isInteger(sessionPage) ? sessionPage : undefined,
      session_only: sessionOnly || undefined,
      session_window: Number.isInteger(sessionWindow) ? sessionWindow : undefined,
      cursor: cursor || undefined
    })
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (response.status === 429 || payload?.code === 'SEARCH_BUSY' || String(payload?.error || '').startsWith('SEARCH_BUSY:')) {
    const retryAfter = parseRetryAfterSeconds(response.headers.get('Retry-After'))
      ?? parseRetryAfterSeconds(payload?.retry_after_seconds);
    throw new Error(`SEARCH_BUSY:${retryAfter || ''}`);
  }
  if (payload?.code === 'SEARCH_UNAVAILABLE') {
    throw new Error(`SEARCH_UNAVAILABLE:${payload?.error || ''}`);
  }
  if (!response.ok || payload?.status !== 'success') throw new Error(payload?.error || 'Search failed.');
  return payload.data;
}

function parseRetryAfterSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3600, Math.ceil(seconds));
  const retryAt = Date.parse(raw);
  if (!Number.isFinite(retryAt)) return null;
  return Math.min(3600, Math.max(1, Math.ceil((retryAt - Date.now()) / 1000)));
}

async function executeSearch({ keyword = '', categoryId = 'all', categoryIds = null, reason = 'search' }) {
  const trimmed = keyword.trim();
  if (!syncPriceRangeFromInputs()) return false;
  const requestedCategoryIds = Array.from(new Set((categoryIds || (categoryId !== 'all' ? [categoryId] : [])).filter(Boolean)));
  if (!trimmed && !requestedCategoryIds.length) {
    $('#search-status').textContent = 'Enter a search term.';
    $('#search-status').classList.add('visible');
    $('#keyword').setAttribute('aria-invalid', 'true');
    $('#keyword').focus();
    return false;
  }
  $('#search-status').textContent = reason === 'price_filter' ? 'Updating results for this price range.' : '';
  $('#search-status').classList.toggle('visible', reason === 'price_filter');
  $('#keyword').removeAttribute('aria-invalid');
  state.requestController?.abort();
  cancelRefreshTracking();
  const requestController = new AbortController();
  state.requestController = requestController;
  state.query = trimmed;
  state.appendError = '';
  state.showFavorites = false;
  state.currentPage = 0;
  if (!['price_filter', 'sort', 'pagination', 'expansion'].includes(reason)) {
    clearSearchSession();
    state.siteWindow = SITE_RESULT_WINDOW_INITIAL;
    state.expansionExhausted = false;
  }
  recordRecentSearch(trimmed);
  state.categoryIds = requestedCategoryIds;
  state.categoryId = requestedCategoryIds.length === 1 ? requestedCategoryIds[0] : 'all';
  if (trimmed) $('#keyword').value = trimmed;
  updateExternalSearchLinks(trimmed);
  renderCategories();
  const selectedSites = getSelectedSites(requestedCategoryIds, trimmed);
  if (!selectedSites.length) {
    showUnavailableSelection();
    return false;
  }
  state.collectionSites = [...selectedSites];
  const fingerprint = makeSearchFingerprint({ keyword: trimmed, categoryIds: requestedCategoryIds, sites: selectedSites });
  setLoading(true);

  try {
    const data = await requestSearchPage({
      keyword: trimmed,
      categoryIds: requestedCategoryIds,
      sites: selectedSites,
      signal: requestController.signal,
      refreshIndex: false
    });
    if (state.requestController !== requestController) return false;
    const accepted = adoptSessionData(data);
    if (!accepted) return false;
    state.data = accepted;
    rememberViewData(accepted);
    state.appendError = '';
    trackSearchRefresh(accepted, fingerprint);
    renderAll();
    return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    state.data = null;
    renderSourceSummary();
    $('.market-app').classList.add('has-results');
    resetRenderedResultSummary();
    hidePagination();
    $('#result-list').innerHTML = `<div class="error-state" role="alert"><span>${escapeHtml(formatSourceMessage(error.message))}</span><button type="button" class="source-retry-button" data-retry-search>Try again</button></div>`;
    return false;
  } finally {
    if (state.requestController === requestController) {
      state.requestController = null;
      setLoading(false);
    }
  }
}

async function loadResultPage(pageIndex) {
  if (!state.data || state.loading) return;
  const pageCount = resultPageCount(availableResultCount());
  const targetPage = clampResultPage(pageIndex, pageCount);
  if (targetPage === state.currentPage) return;
  if (state.sessionId) {
    const loaded = await loadSessionView({ page: targetPage, site: state.activeSite, sessionOnly: true });
    if (loaded) focusCurrentPage();
    return;
  }
  const targetItemCount = Math.min(availableResultCount(), (targetPage + 1) * RESULT_PAGE_SIZE);
  const loadedCount = Array.isArray(state.data.items) ? state.data.items.length : 0;
  if (loadedCount >= targetItemCount) {
    state.currentPage = targetPage;
    renderAll();
    focusCurrentPage();
    return;
  }

  const requestController = new AbortController();
  state.requestController?.abort();
  state.requestController = requestController;
  const categoryIds = selectedCategoryIds();
  const sites = getSelectedSites(categoryIds);
  state.appendError = '';
  setLoading(true, true);
  try {
    while ((state.data?.items || []).length < targetItemCount && state.data?.pagination?.next_cursor) {
      const previousCount = state.data.items.length;
      const nextData = await requestSearchPage({
        keyword: state.query,
        categoryIds,
        sites,
        cursor: state.data.pagination.next_cursor,
        signal: requestController.signal,
        refreshIndex: false
      });
      if (state.requestController !== requestController) return;
      state.data = mergeSearchData(state.data, nextData);
      if (state.data.items.length <= previousCount) break;
    }
    const reachablePages = resultPageCount(Math.min(availableResultCount(), state.data.items.length));
    state.currentPage = clampResultPage(targetPage, reachablePages);
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.appendError = formatSourceMessage(error.message);
    $('#search-status').textContent = `Could not load this page: ${state.appendError}`;
    $('#search-status').classList.add('visible');
  } finally {
    if (state.requestController === requestController) {
      state.requestController = null;
      setLoading(false);
      renderAll();
      focusCurrentPage();
    }
  }
}

function canExpandResultWindow(totalCount = availableResultCount()) {
  const session = sessionInfo();
  const currentWindow = session ? session.window : state.siteWindow;
  const hasBufferedSessionRows = Boolean(session && session.loaded_count > session.window);
  return !state.showFavorites
    && !state.expansionExhausted
    && currentWindow < SITE_RESULT_WINDOW_MAX
    && totalCount < SEARCH_SESSION_MAX_ITEMS
    && (hasBufferedSessionRows || (Boolean(state.data?.pagination?.has_more)
      && Boolean(state.data?.pagination?.next_cursor)));
}

async function expandResultWindow() {
  if (!canExpandResultWindow() || state.loading) return;
  const initialSession = sessionInfo();
  const serverSessionMode = Boolean(state.sessionId && initialSession);
  const previousAvailableCount = availableResultCount();
  const previousCount = serverSessionMode ? initialSession.window : previousAvailableCount;
  const previousPage = state.currentPage;
  const requestController = new AbortController();
  state.requestController?.abort();
  state.requestController = requestController;
  const categoryIds = selectedCategoryIds();
  const sites = getSelectedSites(categoryIds, state.query);
  state.appendError = '';
  $('#search-status').textContent = 'Loading more listings.';
  $('#search-status').classList.add('visible');
  setLoading(true, true);
  try {
    let emptyContinuationHops = 0;
    let addedCount = 0;
    let requestCount = 0;
    const targetCount = Math.min(previousCount + SITE_RESULT_WINDOW_STEP, SITE_RESULT_WINDOW_MAX, SEARCH_SESSION_MAX_ITEMS);
    const targetWindow = targetCount;
    if (serverSessionMode) {
      const exposed = await requestSearchPage({
        keyword: state.query,
        categoryIds,
        sites: state.collectionSites.length ? [...state.collectionSites] : sites,
        viewSites: activeViewSites(),
        sessionId: state.sessionId,
        sessionGeneration: state.sessionGeneration,
        sessionPage: 0,
        sessionOnly: true,
        sessionWindow: targetWindow,
        signal: requestController.signal,
        refreshIndex: false
      });
      if (state.requestController !== requestController) return;
      const acceptedExposed = adoptSessionData(exposed);
      if (!acceptedExposed) return;
      state.data = acceptedExposed;
    }
    do {
      const nextCursor = state.data?.pagination?.next_cursor;
      const beforeSession = sessionInfo();
      const beforeHopCount = serverSessionMode ? beforeSession?.loaded_count || 0 : availableResultCount();
      if (serverSessionMode && beforeHopCount >= targetWindow) break;
      if (!nextCursor) break;
      requestCount += 1;
      const expanded = await requestSearchPage({
        keyword: state.query,
        categoryIds,
        sites: state.collectionSites.length ? [...state.collectionSites] : sites,
        viewSites: activeViewSites(),
        cursor: nextCursor,
        sessionId: serverSessionMode ? state.sessionId : null,
        sessionGeneration: serverSessionMode ? state.sessionGeneration : null,
        sessionPage: serverSessionMode ? 0 : null,
        sessionOnly: false,
        sessionWindow: serverSessionMode ? targetWindow : null,
        signal: requestController.signal,
        refreshIndex: false
      });
      if (state.requestController !== requestController) return;
      if (serverSessionMode) {
        const accepted = adoptSessionData(expanded);
        if (!accepted) return;
        state.data = accepted;
      } else {
        state.data = mergeSearchData(state.data, expanded);
      }
      const afterHopCount = serverSessionMode ? sessionInfo()?.loaded_count || 0 : availableResultCount();
      const hopAddedCount = Math.max(0, afterHopCount - beforeHopCount);
      addedCount += hopAddedCount;
      emptyContinuationHops = hopAddedCount === 0 ? emptyContinuationHops + 1 : 0;
    } while (
      (serverSessionMode ? (sessionInfo()?.loaded_count || 0) : availableResultCount()) < targetCount
      && requestCount < MAX_EXPANSION_REQUESTS
      && emptyContinuationHops < MAX_EMPTY_CONTINUATION_HOPS
      && state.data?.pagination?.has_more
      && state.data?.pagination?.next_cursor
    );
    state.siteWindow = targetWindow;
    if (serverSessionMode) state.sessionWindow = targetWindow;
    const expandedCount = availableResultCount();
    const targetPage = expandedCount > previousAvailableCount
      ? Math.min(previousPage + 1, Math.max(0, resultPageCount(expandedCount) - 1))
      : previousPage;
    if (serverSessionMode) {
      const pageData = await requestSearchPage({
        keyword: state.query,
        categoryIds,
        sites: state.collectionSites.length ? [...state.collectionSites] : sites,
        viewSites: activeViewSites(),
        sessionId: state.sessionId,
        sessionGeneration: state.sessionGeneration,
        sessionPage: targetPage,
        sessionOnly: true,
        sessionWindow: targetWindow,
        signal: requestController.signal,
        refreshIndex: false
      });
      if (state.requestController !== requestController) return;
      const acceptedPage = adoptSessionData(pageData);
      if (!acceptedPage) return;
      state.data = acceptedPage;
      rememberViewData(acceptedPage);
    }
    state.currentPage = clampResultPage(targetPage, resultPageCount(availableResultCount()));
    addedCount = Math.max(0, availableResultCount() - previousAvailableCount);
    const finalSession = sessionInfo();
    const hasBufferedRows = Boolean(finalSession && finalSession.loaded_count > finalSession.window);
    state.expansionExhausted = (serverSessionMode ? state.sessionWindow : state.siteWindow) >= SITE_RESULT_WINDOW_MAX
      || (!hasBufferedRows && (!state.data?.pagination?.has_more || !state.data?.pagination?.next_cursor));
    $('#search-status').textContent = addedCount > 0
      ? `Found ${addedCount} more ${addedCount === 1 ? 'listing' : 'listings'}.`
      : state.expansionExhausted
        ? 'No additional listings were found.'
        : 'No new listings in this batch. More pages are available.';
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.appendError = formatSourceMessage(error.message);
    $('#search-status').textContent = `Could not load more listings: ${state.appendError}`;
  } finally {
    if (state.requestController === requestController) {
      state.requestController = null;
      setLoading(false);
      renderAll();
      focusCurrentPage();
    }
  }
}

function search(keyword) {
  // Keep the category selection when the user submits the top search form.
  // Passing an empty array here silently cleared multi-category searches.
  executeSearch({ keyword, categoryIds: selectedCategoryIds() });
}

function renderAll() {
  if (!state.data) return;
  $('.market-app').classList.add('has-results');
  const visible = visibleItems();
  renderCategories();
  renderResults();
  renderFreshnessStatus();
}

function formatSourceMessage(message) {
  const text = String(message || '');
  if (text.startsWith('SEARCH_BUSY:')) {
    const retryAfter = Number(text.slice('SEARCH_BUSY:'.length));
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `The search service is busy. Please try again in about ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}.`
      : 'The search service is busy. Please try again shortly.';
  }
  if (text.startsWith('SEARCH_UNAVAILABLE:')) return 'Search is temporarily unavailable. Try this marketplace again.';
  if (text.startsWith('CURSOR_EXPIRED:')) return 'These search results expired. Start a new search.';
  if (text.startsWith('CATEGORY_KEYWORD_FALLBACK:')) return 'The category name was used because a marketplace subcategory is unavailable.';
  if (text.startsWith('CATEGORY_PARENT_FALLBACK:')) return 'A verified parent category was used because a marketplace subcategory is unavailable.';
  if (text.startsWith('CATEGORY_KEYWORD_FILTER:') || text.startsWith('CATEGORY_TEXT_FILTER:') || text.startsWith('CATEGORY_SOURCE_FILTER:')) return 'Listings assigned to other categories were excluded.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return 'Could not connect to the search server. Try again.';
  if (text.startsWith('CATEGORY_COLLECTION_UNAVAILABLE:')) return 'This marketplace does not support that category yet.';
  if (text.startsWith('PAGINATION_UNAVAILABLE:')) return 'This marketplace does not provide a reliable next-page cursor.';
  if (text.startsWith('Dropped item due to weak keyword relevance:')) return 'A listing with weak search relevance was excluded.';
  if (text.startsWith('Dropped item due to missing required fields')) return 'A listing missing required information was excluded.';
  if (text.startsWith('Dropped duplicate URL:')) return 'Duplicate listings were combined.';
  if (text.startsWith('BLOCKED_PAGE:') || /blocked page detected|access challenge/i.test(text)) return 'The marketplace limited automated access. Try again or open the marketplace directly.';
  if (text.startsWith('BROWSER_RUNTIME_UNAVAILABLE:')) return 'The local browser collector is unavailable. Check the collection environment.';
  if (text.startsWith('EMPTY_RESULTS:')) return 'No listings were found. The marketplace may have changed its page structure.';
  if (text.startsWith('UNSUPPORTED_EVIDENCE_SHAPE:')) return 'The marketplace response format is not currently supported.';
  if (text.startsWith('SELECTOR_DRIFT:')) return 'The marketplace page structure changed and listing fields could not be read.';
  if (text.startsWith('SEARCH_EXTRACTION_FAILED:')) return 'Listings could not be extracted. Try again.';
  if (text.startsWith('LOGIN_STATE_UNCLEAR:')) return 'The marketplace login state could not be verified.';
  if (text.startsWith('No search rows matched selector:') || text.startsWith('Browser-first extraction unavailable') || text.startsWith('Unsupported evidence shape for')) return 'No listing rows could be read from the marketplace. Try again.';
  if (text.startsWith('Selectors prepared:') || text.startsWith('Adapter notes:')) return 'The marketplace collection rules need review.';
  if (text.startsWith('Keyword fallback was not used')) return 'The search could not run because no category mapping was available.';
  if (text === 'Internal error' || text.startsWith('Internal error')) return 'The search server encountered an error. Try again.';
  return 'The search could not be completed. Try again.';
}

function filteredItems() {
  const minPrice = state.minPrice;
  const maxPrice = state.maxPrice;
  const currentItems = state.data?.items || [];
  const storedItems = Array.from(state.favoriteItems.values());
  const itemsByKey = new Map([...storedItems, ...currentItems].map((item) => [favoriteKey(item), item]));
  let items = Array.from(state.showFavorites ? itemsByKey.values() : currentItems)
    .filter((item) => state.showFavorites || state.activeSite === 'all' || item.site === state.activeSite);
  if (state.showFavorites) items = items.filter((item) => state.favorites.has(favoriteKey(item)));
  const filterCurrency = resultCurrency(items);
  state.priceFilterCurrency = filterCurrency;
  const hasPriceRange = minPrice !== null || maxPrice !== null;
  state.priceFilterIgnored = Boolean(state.data?.filter_meta?.reason === 'mixed_currency'
    || (state.showFavorites && hasPriceRange && filterCurrency === 'MIXED'));
  if (hasPriceRange && !state.priceFilterIgnored) {
    items = items.filter((item) => typeof item.price === 'number'
      && (minPrice === null || item.price >= minPrice)
      && (maxPrice === null || item.price <= maxPrice));
  }
  if (state.sort === 'price_asc') {
    items.sort((a, b) => compareItemPrice(a, b, 'asc'));
  }
  if (state.sort === 'price_desc') {
    items.sort((a, b) => compareItemPrice(a, b, 'desc'));
  }
  if (state.sort === 'recent') {
    items.sort((a, b) => {
      const left = Date.parse(String(a.posted_at || ''));
      const right = Date.parse(String(b.posted_at || ''));
      return (Number.isFinite(right) ? right : Number.NEGATIVE_INFINITY) - (Number.isFinite(left) ? left : Number.NEGATIVE_INFINITY);
    });
  }
  if (state.showFavorites && state.sort === 'recommended') {
    items.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)
      || (Date.parse(String(b.posted_at || '')) || 0) - (Date.parse(String(a.posted_at || '')) || 0));
  }
  return items;
}

function compareItemPrice(left, right, direction) {
  const leftPrice = typeof left?.price === 'number' && Number.isFinite(left.price) ? left.price : null;
  const rightPrice = typeof right?.price === 'number' && Number.isFinite(right.price) ? right.price : null;
  if (leftPrice === null && rightPrice === null) return priceQualityRank(left) - priceQualityRank(right);
  if (leftPrice === null) return 1;
  if (rightPrice === null) return -1;
  const priceOrder = direction === 'desc' ? rightPrice - leftPrice : leftPrice - rightPrice;
  return priceOrder || priceQualityRank(left) - priceQualityRank(right);
}

function priceQualityRank(item) {
  if (typeof item?.price !== 'number' || !Number.isFinite(item.price)) return 3;
  if (item.noise_filtered || (item.fraud_risk != null && item.fraud_risk > .45)) return 2;
  if (item.price_suspect || item.quality_suspect) return 1;
  return 0;
}

function availableResultCount() {
  const session = sessionInfo(state.data);
  if (session) return Math.min(session.available_count, SEARCH_SESSION_MAX_ITEMS);
  return Math.min(filteredItems().length, SEARCH_SESSION_MAX_ITEMS);
}

function visibleItems() {
  const items = filteredItems();
  const sessionPageData = Boolean(sessionInfo() && state.data?._session_page_data);
  if (sessionPageData) return items;
  const start = state.currentPage * RESULT_PAGE_SIZE;
  return items.slice(start, start + RESULT_PAGE_SIZE);
}

function renderPagination(totalCount = availableResultCount()) {
  const root = $('#pagination-controls');
  if (!root) return;
  const pageCount = resultPageCount(totalCount);
  state.currentPage = clampResultPage(state.currentPage, pageCount);
  const canExpand = canExpandResultWindow(totalCount);
  if (pageCount <= 1 && !canExpand) {
    hidePagination();
    return;
  }
  const pageButtons = paginationItems(state.currentPage, pageCount).map((item, index) => (
    item === 'ellipsis'
      ? `<span class="pagination-ellipsis" aria-hidden="true" data-pagination-gap="${index}">…</span>`
      : `<button class="pagination-page" type="button" data-result-page="${item}" aria-label="Page ${item + 1}"${item === state.currentPage ? ' aria-current="page" disabled' : ''}>${item + 1}</button>`
  )).join('');
  const atLastPage = pageCount <= 1 || state.currentPage >= pageCount - 1;
  const expandButton = canExpand && atLastPage
    ? `<button class="pagination-direction" type="button" data-expand-results${state.loading ? ' disabled' : ''}>${'Load more listings'}</button>`
    : '';
  root.innerHTML = `${pageCount > 1 ? `<button class="pagination-direction" type="button" data-result-page="${state.currentPage - 1}" aria-label="${'Previous page'}"${state.currentPage === 0 || state.loading ? ' disabled' : ''}>${'Previous'}</button>${pageButtons}<button class="pagination-direction" type="button" data-result-page="${state.currentPage + 1}" aria-label="${'Next page'}"${atLastPage || state.loading ? ' disabled' : ''}>${'Next'}</button>` : ''}${expandButton}`;
  root.hidden = false;
}

function focusCurrentPage() {
  requestAnimationFrame(() => {
    $('#pagination-controls [aria-current="page"]')?.focus({ preventScroll: true });
    $('.results-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function thumbnailMarkup(item) {
  const imageUrl = safeImageUrl(item.image_url);
  const listingUrl = safeListingUrl(item);
  const fallback = `<div class="item-thumb-fallback" hidden>${'Image unavailable'}</div>`;
  const key = escapeHtml(favoriteKey(item));
  const saved = state.favorites.has(favoriteKey(item));
  const thumbnail = `<div class="item-thumb-wrap">${imageUrl ? `<img class="item-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false;" />` : ''}${imageUrl ? fallback : `<div class="item-thumb-fallback">${'Image unavailable'}</div>`}</div>`;
  const media = listingUrl
    ? `<a class="item-thumb-link" href="${escapeHtml(listingUrl)}" target="_blank" rel="noreferrer noopener" aria-label="${'Open original listing'}" data-item-key="${key}">${thumbnail}</a>`
    : `<span class="item-thumb-link" aria-hidden="true">${thumbnail}</span>`;
  return `<div class="item-media">${media}<button class="heart-button${saved ? ' saved' : ''}" type="button" data-favorite="${key}" aria-label="${saved ? 'Remove saved item' : 'Save item'}" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button></div>`;
}

function sourceCount(source) {
  const count = Number(source?.total_count ?? source?.visible_count ?? source?.count ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function sourceHasFailure(source) {
  return source?.status === 'failed'
    || source?.status === 'error'
    || Boolean(source?.error)
    || (Array.isArray(source?.errors) && source.errors.length > 0);
}

function renderSourceSummary() {
  const root = $('#source-summary');
  if (!root) return;
  const availableSources = Array.isArray(state.data?.sources) ? state.data.sources : [];
  if (!state.data || !availableSources.length) {
    root.innerHTML = '';
    return;
  }
  const expectedSites = getSelectedSites(selectedCategoryIds());
  const sourceByKey = new Map(availableSources.map((source) => [source.key, source]));
  const session = sessionInfo();
  const locallyVisibleItems = filteredItems();
  root.innerHTML = expectedSites.map((site) => {
    const source = sourceByKey.get(site) || { key: site, status: 'empty', count: 0 };
    const count = session
      ? finiteSessionCount(session.source_totals[site])
      : locallyVisibleItems.filter((item) => item.site === site).length;
    const unavailable = !count && source.data_source === 'unavailable' && !(source.errors || []).length;
    const filterWarning = (source.warnings || []).some((warningText) => /키워드 조건|카테고리 조건/.test(String(warningText)));
    const suggested = (source.warnings || []).some((warningText) => /추천 검색어|UPSTREAM_SUGGESTED_KEYWORD/.test(String(warningText)));
    const suggestedKeyword = (source.warnings || [])
      .map((warningText) => String(warningText).match(/UPSTREAM_SUGGESTED_KEYWORD:(.+)$/)?.[1]?.trim() || '')
      .find(Boolean) || '';
    const suggestedLabel = suggestedKeyword ? `${'Suggested'}: ${suggestedKeyword}` : 'Suggested';
    const rateLimited = source.data_source === 'rate_limited';
    const failure = (sourceHasFailure(source) || rateLimited) && !unavailable;
    const partial = Boolean(count && (failure
      || source.collection_state === 'partial'
      || source.status === 'warning'));
    const statusText = failure && !count
      ? rateLimited ? 'Marketplace access limited' : 'Marketplace unavailable'
      : partial ? `${count} ${count === 1 ? 'result' : 'results'} · Partial`
      : filterWarning && count ? `${count} ${count === 1 ? 'result' : 'results'} · Filtered`
          : suggested ? (count ? `${count} ${count === 1 ? 'result' : 'results'} · ${suggestedLabel}` : suggestedLabel)
            : count ? `${count} ${count === 1 ? 'result' : 'results'}` : 'No results';
    const statusClass = failure || partial ? 'is-warning' : count ? '' : 'is-empty';
    const sourceMessages = [...(source.errors || []), ...(source.warnings || [])];
    const sourceDetail = sourceMessages.length ? formatSourceMessage(sourceMessages[0]) : '';
    const detail = sourceDetail || (failure || partial ? 'Showing only listings that could be verified from this marketplace.' : '');
    const retry = failure ? `<button type="button" class="source-retry-button" data-retry-site="${escapeHtml(site)}">Try again</button>` : '';
    return `<span class="source-summary-item ${statusClass}" title="${escapeHtml(detail)}"><span>${escapeHtml(labels[site] || site)} ${escapeHtml(statusText)}</span>${sourceDetail ? `<span class="source-summary-detail">${escapeHtml(sourceDetail)}</span>` : ''}${retry}</span>`;
  }).join('');
}

async function retrySource(site) {
  if (state.loading || !state.data || !GLOBAL_MARKET.countries[state.activeCountry].sites.includes(site)) return;
  const serverSessionMode = Boolean(state.sessionId && sessionInfo());
  const sessionSites = state.collectionSites.length
    ? [...state.collectionSites]
    : getSelectedSites(selectedCategoryIds(), state.query);
  const requestController = new AbortController();
  state.requestController?.abort();
  state.requestController = requestController;
  const categoryIds = selectedCategoryIds();
  const previousPagination = state.data.pagination;
  state.appendError = '';
  setLoading(true, true);
  try {
    const retried = await requestSearchPage({
      keyword: state.query,
      categoryIds,
      sites: serverSessionMode ? sessionSites : [site],
      viewSites: activeViewSites(),
      sessionId: serverSessionMode ? null : state.sessionId,
      sessionGeneration: serverSessionMode ? null : state.sessionGeneration,
      sessionPage: serverSessionMode ? null : 0,
      sessionOnly: false,
      sessionWindow: serverSessionMode ? null : state.sessionWindow,
      signal: requestController.signal,
      refreshIndex: true
    });
    if (state.requestController !== requestController) return;
    if (serverSessionMode && sessionInfo(retried)) {
      clearSearchSession();
      state.collectionSites = sessionSites;
      const accepted = adoptSessionData(retried);
      if (!accepted) return;
      state.data = accepted;
      rememberViewData(accepted);
    } else if (serverSessionMode) {
      clearSearchSession();
      state.collectionSites = sessionSites;
      state.data = retried;
    } else {
      state.data = {
        ...state.data,
        items: (state.data.items || []).filter((item) => item.site !== site),
        sources: (state.data.sources || []).filter((source) => source.key !== site)
      };
      state.data = mergeSearchData(state.data, retried);
      if (previousPagination?.has_more && previousPagination?.next_cursor) {
        state.data.pagination = previousPagination;
      }
    }
    state.currentPage = 0;
    $('#search-status').textContent = `${labels[site] || site} was searched again.`;
    $('#search-status').classList.add('visible');
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.appendError = formatSourceMessage(error.message);
    $('#search-status').textContent = `Could not retry ${labels[site] || site}: ${state.appendError}`;
    $('#search-status').classList.add('visible');
  } finally {
    if (state.requestController === requestController) {
      state.requestController = null;
      setLoading(false);
      renderAll();
    }
  }
}

function renderResults() {
  const items = visibleItems();
  const availableCount = availableResultCount();
  const pageCount = resultPageCount(availableCount);
  const pageText = pageCount > 1 ? ` · Page ${state.currentPage + 1} of ${pageCount}` : '';
  $('#result-count').textContent = `${availableCount} ${availableCount === 1 ? 'result' : 'results'}${pageText}`;
  renderPagination(availableCount);
  renderSourceSummary();
  renderControlNotice();
  updateResultControls();
  if (!items.length) {
    $('#result-list').innerHTML = `<div class="empty-state" role="status"><span>${'No results'}</span></div>`;
    return;
  }
  $('#result-list').innerHTML = items.map((item) => {
    const warning = item.price_suspect || item.quality_suspect || (item.fraud_risk != null && item.fraud_risk > .45);
    const comparison = formatMarketComparison(item);
    const flag = warning ? `<span class="item-flag">${'Review'}</span>` : item.noise_filtered ? `<span class="item-flag">${escapeHtml(formatNoiseReason(item.noise_filter_reason))}</span>` : '';
    const listingTag = ({ part: 'Parts', full_pc: 'Device', bundle: 'Bundle' })[item.listing_type] || '';
    const shipping = formatShipping(item.shipping);
    const tag = shipping || listingTag;
    const priceLabel = formatPriceLabel(item.price_label);
    const feeNote = item.site === 'vinted' ? 'Buyer protection fee may apply' : '';
    const priceHint = [priceLabel, comparison, feeNote].filter(Boolean).join(' · ');
    const itemKey = escapeHtml(favoriteKey(item));
    const sourceLabel = labels[item.site] || 'Unknown source';
    const location = String(item.location || '').trim();
    const condition = formatCondition(item.condition);
    const description = String(item.description || '').replace(/\s+/g, ' ').trim();
    const detail = description.length > 110 ? `${description.slice(0, 110)}…` : description;
    const titleLang = originalLanguageAttr(item.title);
    const locationLang = originalLanguageAttr(location);
    const conditionLang = originalLanguageAttr(condition);
    const detailLang = originalLanguageAttr(detail);
    const tagLang = originalLanguageAttr(tag);
    const listingUrl = safeListingUrl(item);
    const title = listingUrl
      ? `<a class="item-title"${titleLang} href="${escapeHtml(listingUrl)}" target="_blank" rel="noreferrer noopener" data-item-key="${itemKey}">${escapeHtml(item.title)}</a>`
      : `<span class="item-title"${titleLang}>${escapeHtml(item.title)}</span>`;
    return `<article class="item-row">${thumbnailMarkup(item)}<div class="item-main">${title}<div class="item-price"><strong>${formatPrice(item.price, item.currency)}</strong>${priceHint ? `<small>${escapeHtml(priceHint)}</small>` : ''}</div><div class="item-meta"><span class="item-source-badge">${escapeHtml(sourceLabel)}</span>${location ? `<span${locationLang}>${escapeHtml(location)}</span>` : ''}${condition ? `<span${conditionLang}>${escapeHtml(condition)}</span>` : ''}<span>${escapeHtml(formatListingTime(item))}</span>${flag}</div>${detail ? `<p class="item-description"${detailLang}>${escapeHtml(detail)}</p>` : ''}${tag ? `<span class="item-tag"${tagLang}>${escapeHtml(tag)}</span>` : ''}</div></article>`;
  }).join('');
}

function mergeSearchData(previous, next) {
  if (!previous) return next;
  const items = [];
  const seen = new Set();
  [...(previous.items || []), ...(next.items || [])].forEach((item) => {
    const key = canonicalItemKey(item);
    if (seen.has(key) || items.length >= SEARCH_SESSION_MAX_ITEMS) return;
    seen.add(key);
    items.push(item);
  });
  const nextCursor = next.pagination?.next_cursor || null;
  const previousCursor = previous.pagination?.next_cursor || null;
  const cursorAdvanced = Boolean(nextCursor && nextCursor !== previousCursor);
  const sourceMap = new Map();
  [...(previous.sources || []), ...(next.sources || [])].forEach((source) => {
    const old = sourceMap.get(source.key);
    if (!old) {
      sourceMap.set(source.key, { ...source, warnings: [...(source.warnings || [])], errors: [...(source.errors || [])] });
      return;
    }
    sourceMap.set(source.key, {
      ...old,
      count: (old.count || 0) + (source.count || 0),
      normalized_count: (old.normalized_count || 0) + (source.normalized_count || 0),
      visible_count: (old.visible_count || 0) + (source.visible_count || 0),
      status: old.status === 'warning' || source.status === 'warning' ? 'warning' : 'ready',
      warnings: Array.from(new Set([...(old.warnings || []), ...(source.warnings || [])])).slice(0, 3),
      errors: Array.from(new Set([...(old.errors || []), ...(source.errors || [])])).slice(0, 3),
      search_urls: Array.from(new Set([...(old.search_urls || []), ...(source.search_urls || (source.search_url ? [source.search_url] : []))])),
      search_url: old.search_url || source.search_url
    });
  });
  const mergedSources = Array.from(sourceMap.values()).map((source) => {
    const visibleCount = items.filter((item) => item.site === source.key).length;
    return {
      ...source,
      count: visibleCount,
      normalized_count: visibleCount,
      visible_count: visibleCount
    };
  });
  const prices = items.map((item) => item.price).filter((price) => typeof price === 'number' && price > 0);
  const trustedPrices = items.filter((item) => !item.price_suspect && !item.noise_filtered && (item.fraud_risk == null || item.fraud_risk <= .45)).map((item) => item.price).filter((price) => typeof price === 'number' && price > 0);
  return {
    ...next,
    items,
    sources: mergedSources,
    pagination: items.length < SEARCH_SESSION_MAX_ITEMS && next.pagination?.has_more && cursorAdvanced
      ? next.pagination
      : { has_more: false, next_cursor: null },
    summary: {
      ...(next.summary || previous.summary || {}),
      item_count: items.length,
      source_count: mergedSources.filter((source) => source.visible_count > 0).length,
      median_price: median(prices),
      average_price: trustedPrices.length ? Math.round(trustedPrices.reduce((sum, price) => sum + price, 0) / trustedPrices.length) : null,
      lowest_price: trustedPrices.length ? Math.min(...trustedPrices) : null,
      highest_price: trustedPrices.length ? Math.max(...trustedPrices) : null
    },
    quality: {
      ...(next.quality || previous.quality || {}),
      raw_count: (previous.quality?.raw_count || 0) + (next.quality?.raw_count || 0),
      normalized_count: (previous.quality?.normalized_count || 0) + (next.quality?.normalized_count || 0),
      merged_count: items.length,
      available_count: items.length,
      filtered_out_count: (previous.quality?.filtered_out_count || 0) + (next.quality?.filtered_out_count || 0),
      warnings: Array.from(new Set([...(previous.quality?.warnings || []), ...(next.quality?.warnings || [])])).slice(0, 8)
    }
  };
}

function canonicalItemKey(item) {
  const rawUrl = String(item.url || '').trim();
  return rawUrl || item.id || `${item.site}:${item.title}`;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

renderMarketProfile();
$('#search-form').addEventListener('submit', (event) => { event.preventDefault(); search($('#keyword').value); });
$('#country-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-country-tab]');
  if (tab) setActiveCountry(tab.dataset.countryTab || 'jp');
});
$('#site-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-site-tab]');
  if (tab) setActiveSite(tab.dataset.siteTab || 'all');
});
$('#category-panel-toggle').addEventListener('click', () => {
  if (!isMobileViewport()) return;
  state.categoryPanelOpen = !state.categoryPanelOpen;
  syncCategoryPanel();
});
$('#category-list').addEventListener('click', (event) => {
  const toggle = event.target.closest('[data-category-toggle]');
  if (toggle) {
    const branch = document.getElementById(toggle.dataset.categoryBranch || '');
    if (!branch) return;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    branch.hidden = expanded;
    toggle.setAttribute('aria-expanded', String(!expanded));
    toggle.setAttribute('aria-label', expanded ? 'Expand subcategories' : 'Collapse subcategories');
    const icon = toggle.querySelector('.category-toggle');
    if (icon) icon.textContent = expanded ? '+' : '−';
    return;
  }
  const button = event.target.closest('[data-category-id]');
  if (!button || button.disabled) return;
  setCategory(button.dataset.categoryId || 'all');
});
$('#keyword').addEventListener('input', () => {
  $('#search-status').textContent = '';
  $('#search-status').classList.remove('visible');
  $('#keyword').removeAttribute('aria-invalid');
  updateExternalSearchLinks($('#keyword').value);
});
$('#recent-search-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-recent-search]');
  if (!button) return;
  const keyword = button.dataset.recentSearch || '';
  $('#keyword').value = keyword;
  search(keyword);
});
$('#clear-recent-searches').addEventListener('click', () => {
  state.recentSearches = [];
  saveRecentSearches();
  renderRecentSearches();
});
function applyPriceFilter() {
  if (state.loading) return;
  if (!syncPriceRangeFromInputs()) return;
  $('#search-status').textContent = '';
  $('#search-status').classList.remove('visible');
  state.currentPage = 0;
  if (state.sessionId) void refreshSessionView();
  else renderAll();
}

$('#apply-price-filter').addEventListener('click', applyPriceFilter);
['#min-price', '#max-price'].forEach((selector) => {
  $(selector).addEventListener('input', () => {
    $(selector).removeAttribute('aria-invalid');
  });
  $(selector).addEventListener('keydown', (event) => {
    if (event.key === 'Enter') applyPriceFilter();
  });
});
$$('[data-sort]').forEach((tab) => tab.addEventListener('click', () => {
  if (state.loading) return;
  const nextSort = tab.dataset.sort || 'recommended';
  if (nextSort === state.sort) return;
  state.sort = nextSort;
  updateSortTabs();
  const shouldSearch = Boolean(state.data || state.loading);
  if (shouldSearch) {
    state.currentPage = 0;
    if (state.sessionId) void refreshSessionView();
    else renderAll();
  }
}));
$('#result-list').addEventListener('click', (event) => {
  const retryButton = event.target.closest('[data-retry-search]');
  if (retryButton) {
    search(state.query || $('#keyword').value);
    return;
  }
  const button = event.target.closest('[data-favorite]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  toggleFavorite(button);
});
$('#source-summary').addEventListener('click', (event) => {
  const retryButton = event.target.closest('[data-retry-site]');
  if (!retryButton || retryButton.disabled) return;
  retrySource(retryButton.dataset.retrySite);
});
$('#result-list').addEventListener('click', (event) => {
  const link = event.target.closest('[data-item-key]');
  if (!link) return;
  const item = (state.data?.items || []).find((candidate) => favoriteKey(candidate) === link.dataset.itemKey);
  if (item) recordRecentItem(item);
}, true);
$('#reset-filters').addEventListener('click', () => {
  if (state.loading) return;
  const hadPriceRange = state.minPrice !== null || state.maxPrice !== null;
  const shouldSearch = Boolean(state.data || state.loading);
  $('#min-price').value = '';
  $('#max-price').value = '';
  state.minPrice = null;
  state.maxPrice = null;
  updateSortTabs();
  if (shouldSearch && hadPriceRange) {
    state.currentPage = 0;
    if (state.sessionId) void refreshSessionView();
    else renderAll();
  }
});
$('#apply-refresh-results').addEventListener('click', () => {
  if (!state.pendingRefreshData) return;
  const applyingStale = state.pendingResultKind === 'stale';
  const accepted = acceptRefreshPayload(state.pendingRefreshData, { assign: true });
  if (!accepted) return;
  state.pendingRefreshData = null;
  state.pendingResultKind = '';
  if (applyingStale) state.refreshMessage = `${formatCheckedAge(state.data?.freshness)} · ${'Showing saved results'}`;
  state.currentPage = 0;
  renderAll();
  $('.results-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#pagination-controls').addEventListener('click', (event) => {
  const expandButton = event.target.closest('[data-expand-results]');
  if (expandButton && !expandButton.disabled) {
    expandResultWindow();
    return;
  }
  const button = event.target.closest('[data-result-page]');
  if (!button || button.disabled) return;
  loadResultPage(Number(button.dataset.resultPage));
});

renderCategories();
renderRecentViewed();
renderRecentSearches();
window.addEventListener('resize', syncCategoryPanel);
window.addEventListener('pageshow', reloadRecentItems);
window.addEventListener('storage', (event) => {
  if (event.key === storageKey('used-market:recent-items')) reloadRecentItems();
  if (event.key === storageKey('used-market:recent-searches')) {
    state.recentSearches = loadRecentSearches();
    renderRecentSearches();
  }
});
loadCategories();

const presetKeyword = new URLSearchParams(window.location.search).get('keyword')?.trim().slice(0, 80);
if (presetKeyword) {
  $('#keyword').value = presetKeyword;
  search(presetKeyword);
}
