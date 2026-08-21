import { RESULT_PAGE_SIZE, clampResultPage, maxNavigableResultPage, pageResponseMatchesCursor, paginationItems, resultPageCount } from './pagination.mjs?v=pagination-v6';

const APP_ID = 'domestic';
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const MARKET_PROFILE = 'domestic';
const IS_GLOBAL = MARKET_PROFILE === 'global';
const uiText = (korean, english) => IS_GLOBAL ? english : korean;
const storageKey = (base) => IS_GLOBAL ? `${base}:global` : base;
const MARKET_PROFILES = {
  domestic: {
    sites: ['joonggonara', 'bunjang', 'hellomarket', 'rethinkmall'],
    idleText: '중고나라·번개장터·헬로마켓·리씽크몰의 중고매물을 한 번에 비교해 보세요.',
    switchLabel: '해외 시안',
    switchUrl: '/global/'
  },
  global: {
    defaultCountry: 'jp',
    countries: {
      jp: {
        label: 'Japan',
        sites: ['mercari_jp', 'yahoo_auction_jp', 'rakuma'],
        idleText: 'Search and compare public resale listings from Japan.'
      },
      us: {
        label: 'United States',
        sites: ['poshmark', 'vinted', 'unclaimed_baggage'],
        idleText: 'Search and compare public resale listings from the United States.'
      }
    },
    switchLabel: 'Korea Search',
    switchUrl: '/?market=domestic'
  }
};
const INITIAL_COUNTRY = MARKET_PROFILE === 'global' && PAGE_PARAMS.get('country') === 'us' ? 'us' : 'jp';
let DEFAULT_SITES = MARKET_PROFILE === 'global'
  ? MARKET_PROFILES.global.countries[INITIAL_COUNTRY].sites
  : MARKET_PROFILES.domestic.sites;
const SEARCH_ONLY_SITES = new Set(['hellomarket', 'rethinkmall', 'mercari_jp', 'yahoo_auction_jp', 'rakuma', 'poshmark', 'vinted', 'unclaimed_baggage']);
const LISTING_HOSTS_BY_SITE = {
  joonggonara: ['joongna.com'],
  bunjang: ['bunjang.co.kr'],
  hellomarket: ['hellomarket.com'],
  rethinkmall: ['rethinkmall.com'],
  mercari_jp: ['mercari.com'],
  yahoo_auction_jp: ['auctions.yahoo.co.jp'],
  rakuma: ['fril.jp'],
  poshmark: ['poshmark.com'],
  vinted: ['vinted.com'],
  unclaimed_baggage: ['unclaimedbaggage.com'],
  ebay: ['ebay.com'],
  daangn: ['daangn.com']
};
const IMAGE_HOSTS = [
  'i.ebayimg.com',
  'img2.joongna.com',
  'media.bunjang.co.kr',
  'img.bunjang.co.kr',
  'ccimage.hellomarket.com',
  'ccimg.hellomarket.com',
  'static.rethinkmall.com',
  'assets.rethinkmall.com',
  'static.mercdn.net',
  'auc-pctr.c.yimg.jp',
  'auctions.c.yimg.jp',
  'img.fril.jp',
  'images.poshmark.com',
  'dnvefa72aowie.cloudfront.net',
  'vinted.net',
  'unclaimedbaggage.com',
  'img.kr.gcp-karroter.net'
];
const SITE_RESULT_WINDOW_INITIAL = 160;
const SITE_RESULT_WINDOW_STEP = 160;
const SITE_RESULT_WINDOW_MAX = 640;
const SITE_PREFETCH_PAGES = 3;
const SEARCH_SESSION_MAX_ITEMS = 1000;
const REFRESH_POLL_MAX_MS = 180_000;
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
  favorites: loadFavorites(),
  favoriteItems: loadFavoriteItems(),
  recentItems: loadRecentItems(),
  recentSearches: loadRecentSearches(),
  priceFilterIgnored: false,
  priceFilterCurrency: 'KRW',
  categoryPanelOpen: false,
  currentPage: 0,
  siteWindow: SITE_RESULT_WINDOW_INITIAL,
  focusedSiteWindows: {},
  collectionSites: [],
  collectionData: null,
  viewData: new Map(),
  expansionExhausted: false,
  viewCollectionController: null,
  completedViewCollections: new Set(),
  refreshTimer: null,
  refreshToken: '',
  refreshAttempt: 0,
  refreshPollStartedAt: 0,
  refreshFingerprint: '',
  refreshMessage: '',
  pendingRefreshData: null,
  pendingResultKind: ''
};

const labels = {
  all: '전체',
  joonggonara: '중고나라',
  bunjang: '번개장터',
  hellomarket: '헬로마켓',
  rethinkmall: '리씽크몰',
  mercari_jp: 'Mercari JP',
  yahoo_auction_jp: 'Yahoo! Auctions',
  rakuma: 'Rakuma',
  poshmark: 'Poshmark',
  vinted: 'Vinted US',
  unclaimed_baggage: 'Unclaimed Baggage'
};

const fallbackCategories = [
  ['all', '전체', null], ['fashion', '패션의류', null], ['fashion_women', '여성의류', 'fashion'], ['fashion_men', '남성의류', 'fashion'],
  ['fashion_women_outer', '여성 아우터', 'fashion_women'], ['fashion_women_tops', '여성 상의', 'fashion_women'],
  ['fashion_women_bottoms', '여성 바지', 'fashion_women'], ['fashion_women_skirts', '여성 치마', 'fashion_women'],
  ['fashion_men_outer', '남성 아우터', 'fashion_men'], ['fashion_men_tops', '남성 상의', 'fashion_men'],
  ['fashion_men_bottoms', '남성 바지', 'fashion_men'], ['fashion_men_jumpsuit', '남성 점프수트', 'fashion_men'],
  ['fashion_goods', '패션잡화', null], ['luxury', '수입명품', null],
  ['beauty', '뷰티'], ['kids', '출산/유아동'], ['mobile', '모바일/태블릿'], ['appliances', '가전제품'],
  ['pc', '노트북/PC'], ['camera', '카메라/캠코더'], ['furniture', '가구/인테리어'], ['living', '리빙/생활'],
  ['games', '게임'], ['hobby', '반려동물/취미'], ['books', '도서/음반/문구'], ['tickets', '티켓/쿠폰'],
  ['sports', '스포츠'], ['travel', '레저/여행'], ['vehicles', '중고차'], ['motorcycle', '오토바이'],
  ['tools', '공구/산업용품'], ['free_share', '무료나눔']
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

function prioritizeImageResults(items) {
  if (IS_GLOBAL || state.showFavorites || state.sort !== 'recommended') return items;
  const withImages = [];
  const withoutImages = [];
  items.forEach((item) => {
    (safeImageUrl(item?.image_url) ? withImages : withoutImages).push(item);
  });
  return [...withImages, ...withoutImages];
}

function applyMarketShellCopy() {
  document.documentElement.lang = IS_GLOBAL ? 'en' : 'ko';
  if (!IS_GLOBAL) return;
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
      ['Japan Search', '/?market=global&country=jp'],
      ['United States Search', '/?market=global&country=us'],
      ['Korea Search', '/?market=domestic']
    ].map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  }
  const description = 'Search and compare public used listings from marketplaces in Japan and the United States.';
  const title = 'Global Used Listings Search | USED MARKET';
  const canonicalUrl = `https://used-pick.com/?market=global&country=${state.activeCountry}`;
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
  const profile = MARKET_PROFILES[MARKET_PROFILE];
  const countryTabs = $('#country-tabs');
  const countryProfile = MARKET_PROFILE === 'global'
    ? profile.countries[state.activeCountry] || profile.countries[profile.defaultCountry]
    : null;
  DEFAULT_SITES = countryProfile ? countryProfile.sites : profile.sites;
  if (countryTabs) {
    countryTabs.hidden = MARKET_PROFILE !== 'global';
    countryTabs.innerHTML = MARKET_PROFILE === 'global'
      ? Object.entries(profile.countries).map(([country, details]) => {
          const active = state.activeCountry === country;
          return `<button class="${active ? 'active' : ''}" type="button" aria-pressed="${active}" data-country-tab="${escapeHtml(country)}">${escapeHtml(details.label)}</button>`;
        }).join('')
      : '';
  }
  const tabs = $('#site-tabs');
  if (tabs) {
    tabs.innerHTML = [
      `<button class="${state.activeSite === 'all' ? 'active' : ''}" type="button" aria-pressed="${state.activeSite === 'all'}" data-site-tab="all">${uiText('전체', 'All')}</button>`,
      ...DEFAULT_SITES.map((site) => {
        const active = state.activeSite === site;
        return `<button class="${active ? 'active' : ''}" type="button" aria-pressed="${active}" data-site-tab="${escapeHtml(site)}">${escapeHtml(labels[site] || site)}</button>`;
      }),
      `<a class="market-profile-switch" href="${escapeHtml(profile.switchUrl)}">${escapeHtml(profile.switchLabel)}</a>`
    ].join('');
  }
  const idleDescription = $('#idle-description');
  if (idleDescription) idleDescription.textContent = countryProfile?.idleText || profile.idleText;
  const keyword = $('#keyword');
  if (keyword) keyword.placeholder = MARKET_PROFILE === 'global'
    ? 'Search by product, brand, or model (e.g. iPhone 13)'
    : '무엇을 찾으시나요?';
  const brand = $('.brand');
  if (brand) brand.href = MARKET_PROFILE === 'global' ? `/?market=global&country=${state.activeCountry}` : '/';
  if (MARKET_PROFILE === 'global') {
    document.title = 'Global Used Listings Search | USED MARKET';
  }
  document.documentElement.dataset.marketProfile = MARKET_PROFILE;
  document.documentElement.dataset.marketCountry = MARKET_PROFILE === 'global' ? state.activeCountry : 'kr';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function formatPrice(value, currency = 'KRW') {
  if (currency === 'MIXED') return uiText('통화 혼합', 'Mixed currencies');
  if (typeof value !== 'number') return uiText('가격 확인', 'Price unavailable');
  const normalizedCurrency = String(currency || 'KRW').toUpperCase();
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
  return 'KRW';
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
  const mixedCurrency = resultCurrency(state.data) === 'MIXED';
  if (filterMeta.reason === 'mixed_currency') {
    return uiText('통화가 섞여 가격 범위를 적용하지 않았습니다. 사이트 하나를 선택한 뒤 다시 설정해 주세요.', 'The price range was not applied because the results use multiple currencies. Select one marketplace and try again.');
  }
  if (sortMeta.reason === 'mixed_currency' || mixedCurrency) {
    return uiText('통화가 섞여 있습니다. 사이트 하나를 선택하면 가격순·가격 범위를 사용할 수 있습니다.', 'These results use multiple currencies. Select one marketplace to sort or filter by price.');
  }
  if (['no_valid_dates', 'missing_dates'].includes(sortMeta.reason)) {
    return uiText('등록일 정보가 없어 최신순을 적용하지 않았습니다.', 'Newest was not applied because listing dates are unavailable.');
  }
  if (sortMeta.reason === 'no_comparable_prices') {
    return uiText('비교 가능한 가격이 없어 가격순을 적용하지 않았습니다.', 'Price sorting was not applied because comparable prices are unavailable.');
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
  const items = state.data?.items || [];
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
        ? uiText('등록일이 있는 매물이 없습니다.', 'No listings include a usable date.')
        : uiText('통화가 섞인 결과는 사이트를 선택한 뒤 가격순으로 볼 수 있습니다.', 'Select one marketplace before sorting results that use multiple currencies.')
      : '';
  });
  ['#min-price', '#max-price', '#apply-price-filter'].forEach((selector) => {
    const control = $(selector);
    if (control) control.disabled = state.loading || mixedCurrency;
  });
  const reset = $('#reset-filters');
  if (reset) reset.disabled = state.loading;
  const priceStep = ['USD', 'EUR', 'GBP', 'SGD'].includes(currency) ? '0.01' : '1';
  const currencyHint = currency === 'MIXED' ? uiText('통화 혼합', 'Mixed') : currency;
  const minInput = $('#min-price');
  const maxInput = $('#max-price');
  if (minInput) {
    minInput.step = priceStep;
    minInput.placeholder = IS_GLOBAL ? 'Minimum price' : `최소 (${currencyHint})`;
  }
  if (maxInput) {
    maxInput.step = priceStep;
    maxInput.placeholder = IS_GLOBAL ? 'Maximum price' : `최대 (${currencyHint})`;
  }
}

function formatNoiseReason(value) {
  const reasons = IS_GLOBAL ? {
    guide_or_advertisement: 'Guide or promotional listing',
    placeholder_price: 'Price needs verification',
    bundled_part_offer: 'Bundle details need verification',
    part_build_leak: 'Parts configuration needs verification'
  } : {
    guide_or_advertisement: '광고·안내성 매물',
    placeholder_price: '기준가 확인 필요',
    bundled_part_offer: '묶음·구성 확인 필요',
    part_build_leak: '부품 구성 확인 필요'
  };
  return reasons[String(value || '')] || uiText('참고 제외', 'Excluded reference');
}

function formatPostedAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return uiText('등록일 미상', 'Date unavailable');
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  const elapsed = Math.max(0, Date.now() - date.getTime());
  if (elapsed < 60 * 1000) return uiText('방금 전', 'Just now');
  if (elapsed < 60 * 60 * 1000) return IS_GLOBAL ? `${Math.floor(elapsed / (60 * 1000))} min ago` : `${Math.floor(elapsed / (60 * 1000))}분 전`;
  if (elapsed < 24 * 60 * 60 * 1000) return IS_GLOBAL ? `${Math.floor(elapsed / (60 * 60 * 1000))} hr ago` : `${Math.floor(elapsed / (60 * 60 * 1000))}시간 전`;
  if (elapsed < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(elapsed / (24 * 60 * 60 * 1000));
    return IS_GLOBAL ? `${days} ${days === 1 ? 'day' : 'days'} ago` : `${days}일 전`;
  }
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function formatCondition(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.toLowerCase();
  if (/for parts|not working|no power/.test(normalized)) return uiText('부품용·작동불가', 'For parts / Not working');
  if (/locked|restricted/.test(normalized)) return uiText('잠금·사용제한 확인', 'Locked / Restricted');
  if (/demo|display unit/.test(normalized)) return uiText('전시·데모 기기', 'Demo / Display unit');
  if (/new without tags/.test(normalized)) return uiText('택 없는 새 상품', 'New without tags');
  if (/like new/.test(normalized)) return uiText('새것에 가까움', 'Like new');
  if (/near mint/.test(normalized)) return IS_GLOBAL ? raw : '새것에 가까움';
  if (/excellent/.test(normalized)) return uiText('최상', 'Excellent');
  if (/very good/.test(normalized)) return uiText('매우 양호', 'Very good');
  if (/satisfactory/.test(normalized)) return uiText('사용감 있음', 'Satisfactory');
  if (/\bfair\b/.test(normalized)) return uiText('보통', 'Fair');
  if (/\bgood\b/.test(normalized)) return uiText('양호', 'Good');
  return raw;
}

function formatShipping(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(free_shipping|free shipping)$/i.test(raw)) return uiText('무료배송', 'Free Shipping');
  if (/送料未定/.test(raw)) return uiText('배송비 미정', 'Shipping TBD');
  const yen = raw.match(/送料\s*([\d,]+)\s*円/i);
  if (yen) return IS_GLOBAL ? `Shipping ¥${yen[1]}` : `배송비 ¥${yen[1]}`;
  return raw;
}

function formatListingTime(item) {
  const raw = String(item?.posted_at || '').trim();
  if (item?.site === 'yahoo_auction_jp' && raw) {
    const day = raw.match(/(\d+)\s*日/);
    if (day) return IS_GLOBAL ? `Ends in ${day[1]} ${Number(day[1]) === 1 ? 'day' : 'days'}` : `마감까지 ${day[1]}일`;
    const hour = raw.match(/(\d+)\s*時間/);
    if (hour) return IS_GLOBAL ? `Ends in ${hour[1]} ${Number(hour[1]) === 1 ? 'hour' : 'hours'}` : `마감까지 ${hour[1]}시간`;
    const minute = raw.match(/(\d+)\s*分/);
    if (minute) return IS_GLOBAL ? `Ends in ${minute[1]} ${Number(minute[1]) === 1 ? 'minute' : 'minutes'}` : `마감까지 ${minute[1]}분`;
    if (/終了|ended/i.test(raw)) return uiText('경매 종료', 'Auction ended');
  }
  return formatPostedAt(raw);
}

function formatMarketComparison(item) {
  if (item.price_suspect) return uiText('가격 확인', 'Price needs verification');
  if (item.site === 'yahoo_auction_jp' || /입찰|bid/i.test(String(item.price_label || ''))) return uiText('최종가 아님', 'Final price may change');
  const rate = Number(item.deviation_rate);
  if (!Number.isFinite(rate) || rate === 0) return '';
  return rate > 0
    ? IS_GLOBAL ? `${Math.round(rate * 100)}% below market` : `시세 대비 ${Math.round(rate * 100)}% 낮음`
    : IS_GLOBAL ? `${Math.round(Math.abs(rate) * 100)}% above market` : `시세 대비 ${Math.round(Math.abs(rate) * 100)}% 높음`;
}

function formatPriceLabel(value) {
  const raw = String(value || '').trim();
  if (!IS_GLOBAL) return raw;
  if (/^(판매가|sale price|listing price)$/i.test(raw)) return 'Sale price';
  if (/^(현재 입찰가|current bid)$/i.test(raw)) return 'Current bid';
  return raw;
}

function formatCheckedAge(freshness) {
  let seconds = Number(freshness?.age_seconds);
  if (!Number.isFinite(seconds) && freshness?.refreshed_at) {
    seconds = Math.max(0, Math.floor((Date.now() - Date.parse(freshness.refreshed_at)) / 1000));
  }
  if (!Number.isFinite(seconds) || seconds < 60) return uiText('방금 확인', 'Checked just now');
  if (seconds < 60 * 60) return IS_GLOBAL ? `Checked ${Math.floor(seconds / 60)} min ago` : `${Math.floor(seconds / 60)}분 전 확인`;
  if (seconds < 24 * 60 * 60) return IS_GLOBAL ? `Checked ${Math.floor(seconds / (60 * 60))} hr ago` : `${Math.floor(seconds / (60 * 60))}시간 전 확인`;
  const days = Math.floor(seconds / (24 * 60 * 60));
  return IS_GLOBAL ? `Checked ${days} ${days === 1 ? 'day' : 'days'} ago` : `${days}일 전 확인`;
}

function originalLanguageAttr(value) {
  return IS_GLOBAL && /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || '')) ? ' lang="ja"' : '';
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
    title: item.title || uiText('제목 없음', 'Untitled listing'),
    price: item.price,
    currency: item.currency || 'KRW',
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
    root.innerHTML = `<div class="recent-viewed-empty"><span class="recent-viewed-empty-icon" aria-hidden="true">⌕</span><p>${uiText('최근 본 상품이 없습니다.', 'No recently viewed items.')}</p></div>`;
    return;
  }
  root.innerHTML = state.recentItems.map((item) => {
    const imageUrl = safeImageUrl(item.image_url);
    const listingUrl = safeListingUrl(item);
    const title = escapeHtml(item.title || uiText('제목 없음', 'Untitled listing'));
    const key = escapeHtml(favoriteKey(item));
    const image = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false;" /><span class="recent-viewed-thumb-fallback" hidden>${uiText('이미지 없음', 'Image unavailable')}</span>`
      : `<span class="recent-viewed-thumb-fallback">${uiText('이미지 없음', 'Image unavailable')}</span>`;
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
  button.setAttribute('aria-label', saved ? uiText('찜 해제', 'Remove saved item') : uiText('찜', 'Save item'));
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
  if (!ids.length) return '전체';
  const names = ids
    .map((id) => (state.categories.find((category) => category.id === id) || fallbackCategories.find((category) => category.id === id))?.label)
    .filter(Boolean);
  if (names.length <= 1) return names[0] || '전체';
  return `${names[0]} 외 ${names.length - 1}개`;
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
  toggle.setAttribute('aria-label', open ? '카테고리 선택 접기' : '카테고리 선택 펼치기');
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

function activeViewSites() {
  return state.activeSite === 'all' ? [] : [state.activeSite];
}

function currentResultWindow() {
  return state.activeSite === 'all'
    ? state.siteWindow
    : state.focusedSiteWindows[state.activeSite] || SITE_RESULT_WINDOW_INITIAL;
}

function viewDataKey(site = state.activeSite) {
  return JSON.stringify({ site, sort: state.sort, minPrice: state.minPrice, maxPrice: state.maxPrice });
}

function previewDataForSite(site) {
  const cached = state.viewData.get(viewDataKey(site));
  if (cached) return cached;
  if (!state.collectionData) return null;
  if (site === 'all') return state.collectionData;
  const items = (state.collectionData.items || []).filter((item) => item.site === site);
  const sources = (state.collectionData.sources || []).filter((source) => source.key === site);
  return {
    ...state.collectionData,
    items,
    sources,
    pagination: { has_more: false, next_cursor: null },
    quality: {
      ...(state.collectionData.quality || {}),
      available_count: items.length,
      merged_count: items.length
    }
  };
}

function rememberViewData(data) {
  if (!data) return;
  if (state.activeSite === 'all') state.collectionData = data;
  else state.viewData.set(viewDataKey(), data);
}

function renderCategories() {
  if (IS_GLOBAL) {
    const root = $('#category-list');
    if (root) root.innerHTML = '';
    return;
  }
  const categories = state.categories.length ? state.categories : fallbackCategories;
  const selectedIds = new Set(selectedCategoryIds());
  const openParentIds = new Set(selectedIds);
  selectedIds.forEach((selectedId) => {
    let parentId = categories.find((category) => category.id === selectedId)?.parentId;
    while (parentId) {
      openParentIds.add(parentId);
      parentId = categories.find((category) => category.id === parentId)?.parentId;
    }
  });
  const childrenByParent = new Map();
  categories.forEach((category) => {
    if (!category.parentId) return;
    const children = childrenByParent.get(category.parentId) || [];
    children.push(category);
    childrenByParent.set(category.parentId, children);
  });
  const renderNode = (category, depth = 0) => {
    const active = selectedIds.has(category.id);
    const unavailable = category.id !== 'all' && !categorySelectable(category.id);
    const children = childrenByParent.get(category.id) || [];
    const expanded = children.length > 0 && openParentIds.has(category.id);
    const branchId = `category-branch-${category.id}`;
    const title = unavailable ? '현재 선택한 사이트에서 지원하지 않는 카테고리입니다.' : category.description || '';
    return `<div class="category-node"><div class="category-row"><button class="${active ? 'active ' : ''}${unavailable ? 'is-unavailable ' : ''}category-select category-depth-${depth}" type="button" data-category-id="${escapeHtml(category.id)}"${active ? ' aria-current="page"' : ''} aria-pressed="${active}"${unavailable ? ' disabled aria-disabled="true"' : ''} title="${escapeHtml(title)}">${escapeHtml(category.label)}</button>${children.length ? `<button class="category-toggle-button" type="button" data-category-toggle data-category-branch="${branchId}" aria-expanded="${expanded}" aria-controls="${branchId}" aria-label="${expanded ? '하위 카테고리 접기' : '하위 카테고리 펼치기'}"><span class="category-toggle" aria-hidden="true">${expanded ? '−' : '+'}</span></button>` : ''}</div>${children.length ? `<div class="category-branch" id="${branchId}"${expanded ? '' : ' hidden'}>${children.map((child) => renderNode(child, depth + 1)).join('')}</div>` : ''}</div>`;
  };
  $('#category-list').innerHTML = categories.filter((category) => !category.parentId).map((category) => renderNode(category)).join('');
  syncCategoryPanel();
}

async function loadCategories() {
  try {
    const response = await fetch('/api/categories');
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
  state.refreshPollStartedAt = 0;
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
  message.textContent = state.refreshMessage || (checking ? `${base} · ${uiText('최신 매물 확인 중', 'Checking for new listings')}` : base);
  root.hidden = false;
  root.classList.toggle('is-checking', checking);
  button.hidden = !state.pendingRefreshData;
  if (state.pendingRefreshData) {
    if (state.pendingResultKind === 'stale') {
      button.textContent = uiText('오래된 결과 보기', 'View saved results');
    } else {
      const added = Math.max(0, Number(state.pendingRefreshData?.refresh?.added_count) || 0);
      button.textContent = added > 0
        ? IS_GLOBAL ? `View ${added} new ${added === 1 ? 'listing' : 'listings'}` : `새 매물 ${added}개 보기`
        : uiText('업데이트 보기', 'View update');
    }
  }
}

function refreshPollDelay(serverDelayMs, attempt) {
  const serverDelay = Math.min(20_000, Math.max(1_000, Number(serverDelayMs) || 2_000));
  const backoffDelay = Math.min(20_000, 2_000 * (2 ** Math.min(Math.max(0, attempt), 4)));
  return Math.max(serverDelay, backoffDelay);
}

function scheduleRefreshPoll(serverDelayMs = 2_000) {
  if (!state.refreshToken) return;
  if (!state.refreshPollStartedAt) state.refreshPollStartedAt = Date.now();
  const elapsed = Date.now() - state.refreshPollStartedAt;
  if (elapsed >= REFRESH_POLL_MAX_MS) {
    state.refreshToken = '';
    state.refreshTimer = null;
    state.refreshPollStartedAt = 0;
    state.refreshMessage = `${formatCheckedAge(state.data?.freshness)} · ${uiText('최신 확인 지연', 'Update delayed')}`;
    renderFreshnessStatus();
    return;
  }
  const delay = Math.min(refreshPollDelay(serverDelayMs, state.refreshAttempt), REFRESH_POLL_MAX_MS - elapsed);
  state.refreshAttempt += 1;
  state.refreshTimer = setTimeout(() => { void pollRefreshResult(); }, delay);
}

async function pollRefreshResult() {
  const token = state.refreshToken;
  const fingerprint = state.refreshFingerprint;
  if (!token || !fingerprint) return;
  try {
    const response = await fetch(`/api/search/refresh/${encodeURIComponent(token)}`);
    const payload = await response.json();
    if (token !== state.refreshToken || fingerprint !== state.refreshFingerprint) return;
    if (response.status === 202) {
      scheduleRefreshPoll(payload.data?.refresh?.poll_after_ms);
      return;
    }
    if (!response.ok || payload.status !== 'success' || !payload.data?.items) {
      state.refreshToken = '';
      state.refreshPollStartedAt = 0;
      state.refreshMessage = `${formatCheckedAge(state.data?.freshness)} · ${uiText('최신 확인 지연', 'Update delayed')}`;
      renderFreshnessStatus();
      return;
    }
    const refreshedData = payload.data;
    const added = Math.max(0, Number(refreshedData.refresh?.added_count) || 0);
    state.refreshToken = '';
    state.refreshTimer = null;
    state.refreshPollStartedAt = 0;
    state.refreshMessage = added > 0
      ? IS_GLOBAL ? `Checked just now · ${added} new ${added === 1 ? 'listing' : 'listings'}` : `방금 확인 · 새 매물 ${added}개`
      : uiText('방금 확인 · 새 매물 없음', 'Checked just now · No new listings');
    if (state.currentPage === 0) {
      state.data = refreshedData;
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
  state.refreshPollStartedAt = 0;
  state.pendingRefreshData = null;
  state.pendingResultKind = '';
  state.refreshMessage = '';
  if (data?.stale_fallback?.items?.length) {
    state.pendingRefreshData = data.stale_fallback;
    state.pendingResultKind = 'stale';
    state.refreshMessage = IS_GLOBAL
      ? `Marketplace check failed · Showing results ${formatCheckedAge(data.stale_fallback.freshness).toLowerCase()}`
      : `원본 사이트 확인 실패 · ${formatCheckedAge(data.stale_fallback.freshness)} 결과 보관 중`;
  }
  const token = String(data?.freshness?.refresh_token || data?.refresh?.token || '').trim();
  const refreshState = String(data?.freshness?.refresh_state || data?.refresh?.state || '');
  state.refreshToken = ['queued', 'running'].includes(refreshState) ? token : '';
  state.refreshFingerprint = state.refreshToken ? fingerprint : '';
  state.refreshPollStartedAt = state.refreshToken ? Date.now() : 0;
  if (state.refreshToken) scheduleRefreshPoll(data?.refresh?.poll_after_ms);
  renderFreshnessStatus();
}

async function setActiveSite(site) {
  const enteringMixedJapanAggregate = MARKET_PROFILE === 'global'
    && state.activeCountry === 'jp'
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
      $('#search-status').textContent = `${labels[site] || site}에서 지원하지 않는 ${removedLabels.join(', ')} 카테고리를 제외했습니다.`;
      $('#search-status').classList.add('visible');
      if (!compatible.length && !state.query) {
        showUnavailableSelection(removed[0]);
        return;
      }
    }
  }
  const compatibleSelected = selectedCategoryIds();
  if (state.query || compatibleSelected.length) {
    const preview = previewDataForSite(site);
    if (preview) {
      state.data = preview;
      state.currentPage = 0;
      renderAll();
    } else if (state.data) renderAll();
    const canReuseCollection = site === 'all'
      ? state.collectionSites.length > 1
      : state.collectionSites.includes(site);
    const searched = await executeSearch({
      keyword: state.query,
      categoryIds: compatibleSelected,
      reason: canReuseCollection ? 'site_filter' : 'search'
    });
    if (searched && site !== 'all') {
      void collectActiveView({
        acquisitionMode: 'recent',
        targetWindow: Math.max(currentResultWindow(), SITE_RESULT_WINDOW_INITIAL + SITE_RESULT_WINDOW_STEP),
        statusText: `${labels[site] || site} 매물을 더 확인하고 있습니다.`
      });
    }
    return;
  }
  state.data = null;
  $('.market-app').classList.remove('has-results');
  resetRenderedResultSummary();
  hidePagination();
  $('#result-list').innerHTML = '<div class="empty-state" aria-hidden="true"></div>';
}

function setActiveCountry(country) {
  if (MARKET_PROFILE !== 'global' || !MARKET_PROFILES.global.countries[country] || state.activeCountry === country) return;
  state.activeCountry = country;
  state.activeSite = 'all';
  state.sort = 'recommended';
  state.minPrice = null;
  state.maxPrice = null;
  state.showFavorites = false;
  $('#min-price').value = '';
  $('#max-price').value = '';
  updateSortTabs();
  const url = new URL(window.location.href);
  url.searchParams.set('market', 'global');
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
  $('#search-status').textContent = IS_GLOBAL
    ? `The selected category is unavailable on ${labels[state.activeSite] || state.activeSite}.`
    : `${categoryLabel || '선택한 카테고리'}는 현재 ${labels[state.activeSite] || state.activeSite}에서 제공되지 않습니다.`;
  $('#search-status').classList.add('visible');
  resetRenderedResultSummary();
  $('#result-list').innerHTML = `<div class="empty-state" role="status"><span>${uiText('지원하지 않는 카테고리', 'Category unavailable')}</span></div>`;
  hidePagination();
  $('.market-app').classList.add('has-results');
}

function resetRenderedResultSummary() {
  $('#result-count').textContent = uiText('0개', '0 results');
  state.priceFilterIgnored = false;
  state.priceFilterCurrency = 'KRW';
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
    $('#search-status').textContent = uiText('가격 범위를 확인해 주세요.', 'Check the price range.');
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
  button.querySelector('span').textContent = loading && !pageChange ? uiText('검색 중', 'Searching') : uiText('검색', 'Search');
  updateResultControls();
  if (state.data) renderPagination();
  if (loading && !pageChange) {
    $('#result-list').innerHTML = `<div class="loading-state"><div class="loading-ring"></div><strong>${uiText('검색 중', 'Searching')}</strong></div>`;
  }
}

async function requestSearchPage({ keyword, categoryIds, sites, viewSites = activeViewSites(), focusSites = [], cursor = null, signal, refreshIndex = false, siteWindow = currentResultWindow(), expandIndex = false, collectView = false, acquisitionMode = 'recent' }) {
  const response = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      keyword,
      category_id: categoryIds.length === 1 ? categoryIds[0] : undefined,
      category_ids: categoryIds.length > 1 ? categoryIds : undefined,
      sites,
      view_sites: viewSites.length ? viewSites : undefined,
      focus_sites: focusSites.length ? focusSites : undefined,
      sort: state.sort,
      min_price: state.minPrice ?? undefined,
      max_price: state.maxPrice ?? undefined,
      limit: RESULT_PAGE_SIZE,
      site_window: MARKET_PROFILE === 'global' ? undefined : siteWindow,
      refresh_index: refreshIndex,
      expand_index: MARKET_PROFILE === 'global' ? undefined : expandIndex,
      collect_view: MARKET_PROFILE === 'global' ? undefined : collectView,
      acquisition_mode: MARKET_PROFILE === 'global' ? undefined : acquisitionMode,
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
  if (!response.ok || payload?.status !== 'success') throw new Error(payload?.error || uiText('검색에 실패했습니다.', 'Search failed.'));
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
    $('#search-status').textContent = uiText('검색어를 입력하세요', 'Enter a search term.');
    $('#search-status').classList.add('visible');
    $('#keyword').setAttribute('aria-invalid', 'true');
    $('#keyword').focus();
    return false;
  }
  $('#search-status').textContent = reason === 'price_filter' ? uiText('가격 조건으로 다시 검색 중입니다.', 'Updating results for this price range.') : '';
  $('#search-status').classList.toggle('visible', reason === 'price_filter');
  $('#keyword').removeAttribute('aria-invalid');
  state.requestController?.abort();
  state.viewCollectionController?.abort();
  state.viewCollectionController = null;
  cancelRefreshTracking();
  const requestController = new AbortController();
  state.requestController = requestController;
  state.query = trimmed;
  state.appendError = '';
  state.showFavorites = false;
  state.currentPage = 0;
  if (!['price_filter', 'sort', 'pagination', 'expansion', 'site_filter'].includes(reason)) {
    state.siteWindow = SITE_RESULT_WINDOW_INITIAL;
    state.focusedSiteWindows = {};
    state.collectionSites = [];
    state.collectionData = null;
    state.viewData = new Map();
    state.completedViewCollections = new Set();
    state.expansionExhausted = false;
  }
  recordRecentSearch(trimmed);
  state.categoryIds = requestedCategoryIds;
  state.categoryId = requestedCategoryIds.length === 1 ? requestedCategoryIds[0] : 'all';
  if (trimmed) $('#keyword').value = trimmed;
  renderCategories();
  const directlySelectedSites = getSelectedSites(requestedCategoryIds, trimmed);
  const canReuseCollection = ['price_filter', 'sort', 'pagination', 'expansion', 'site_filter'].includes(reason)
    && state.collectionSites.length > 0;
  const selectedSites = canReuseCollection ? [...state.collectionSites] : directlySelectedSites;
  if (!selectedSites.length) {
    showUnavailableSelection();
    return false;
  }
  if (!canReuseCollection) state.collectionSites = [...selectedSites];
  const fingerprint = makeSearchFingerprint({ keyword: trimmed, categoryIds: requestedCategoryIds, sites: selectedSites });
  setLoading(true, ['price_filter', 'sort', 'site_filter'].includes(reason));

  try {
    const data = await requestSearchPage({
      keyword: trimmed,
      categoryIds: requestedCategoryIds,
      sites: selectedSites,
      viewSites: activeViewSites(),
      signal: requestController.signal,
      refreshIndex: MARKET_PROFILE === 'global'
        ? false
        : !['price_filter', 'sort', 'pagination', 'site_filter'].includes(reason)
    });
    if (state.requestController !== requestController) return false;
    state.data = data;
    rememberViewData(data);
    state.appendError = '';
    trackSearchRefresh(data, fingerprint);
    renderAll();
    if (reason === 'price_filter') {
      $('#search-status').textContent = '';
      $('#search-status').classList.remove('visible');
    }
    return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    state.data = null;
    renderSourceSummary();
    $('.market-app').classList.add('has-results');
    resetRenderedResultSummary();
    hidePagination();
    $('#result-list').innerHTML = `<div class="error-state" role="alert">${escapeHtml(formatSourceMessage(error.message))}</div>`;
    return false;
  } finally {
    if (state.requestController === requestController) {
      state.requestController = null;
      setLoading(false);
    }
  }
}

async function collectActiveView({ acquisitionMode = 'recent', targetWindow = currentResultWindow(), statusText = '' } = {}) {
  if (MARKET_PROFILE === 'global' || !state.data || !state.collectionSites.length) return false;
  const viewSites = activeViewSites();
  const focusSites = viewSites.length ? viewSites : [...state.collectionSites];
  const fingerprint = JSON.stringify({
    query: state.query,
    categories: selectedCategoryIds(),
    collectionSites: state.collectionSites,
    viewSites,
    acquisitionMode,
    targetWindow,
    minPrice: state.minPrice,
    maxPrice: state.maxPrice
  });
  if (state.completedViewCollections.has(fingerprint)) return true;
  state.viewCollectionController?.abort();
  const requestController = new AbortController();
  state.viewCollectionController = requestController;
  renderPagination();
  const pageBeforeCollection = state.currentPage;
  if (statusText) {
    $('#search-status').textContent = statusText;
    $('#search-status').classList.add('visible');
  }
  try {
    let data = await requestSearchPage({
      keyword: state.query,
      categoryIds: selectedCategoryIds(),
      sites: state.collectionSites,
      viewSites,
      focusSites,
      signal: requestController.signal,
      refreshIndex: false,
      siteWindow: targetWindow,
      collectView: true,
      acquisitionMode
    });
    if (state.viewCollectionController !== requestController) return false;
    const targetItemCount = Math.min(availableResultCount(data), SITE_PREFETCH_PAGES * RESULT_PAGE_SIZE);
    while ((data.items || []).length < targetItemCount && data.pagination?.next_cursor) {
      const previousCount = data.items.length;
      const nextData = await requestSearchPage({
        keyword: state.query,
        categoryIds: selectedCategoryIds(),
        sites: state.collectionSites,
        viewSites,
        cursor: data.pagination.next_cursor,
        signal: requestController.signal,
        refreshIndex: false,
        siteWindow: targetWindow,
        acquisitionMode
      });
      if (state.viewCollectionController !== requestController) return false;
      data = mergeSearchData(data, nextData);
      if (data.items.length <= previousCount) break;
    }
    state.completedViewCollections.add(fingerprint);
    if (viewSites.length === 1) state.focusedSiteWindows[viewSites[0]] = targetWindow;
    else state.siteWindow = targetWindow;
    state.data = data;
    rememberViewData(data);
    const pageToKeep = Number.isInteger(state.currentPage) ? state.currentPage : pageBeforeCollection;
    state.currentPage = clampResultPage(pageToKeep, resultPageCount(availableResultCount(data)));
    state.expansionExhausted = false;
    $('#search-status').textContent = '추가 매물을 반영했습니다.';
    state.viewCollectionController = null;
    renderAll();
    return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;
    $('#search-status').textContent = `추가 매물 확인 실패: ${formatSourceMessage(error.message)}`;
    $('#search-status').classList.add('visible');
    return false;
  } finally {
    if (state.viewCollectionController === requestController) {
      state.viewCollectionController = null;
      renderPagination();
    }
  }
}

async function loadResultPage(pageIndex) {
  if (!state.data || state.loading) return;
  const pageCount = resultPageCount(availableResultCount());
  const loadedCount = Array.isArray(state.data.items) ? state.data.items.length : 0;
  const maxNavigablePage = maxNavigableResultPage(loadedCount, availableResultCount(), Boolean(state.data.pagination?.next_cursor));
  const targetPage = clampResultPage(Math.min(pageIndex, maxNavigablePage), pageCount);
  if (targetPage === state.currentPage) return;
  const targetItemCount = Math.min(availableResultCount(), (targetPage + 1) * RESULT_PAGE_SIZE);
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
  const sites = state.collectionSites.length ? [...state.collectionSites] : getSelectedSites(categoryIds);
  state.appendError = '';
  setLoading(true, true);
  try {
    while ((state.data?.items || []).length < targetItemCount && state.data?.pagination?.next_cursor) {
      const previousCount = state.data.items.length;
      const requestedCursor = state.data.pagination.next_cursor;
      const nextData = await requestSearchPage({
        keyword: state.query,
        categoryIds,
        sites,
        viewSites: activeViewSites(),
        cursor: requestedCursor,
        signal: requestController.signal,
        refreshIndex: false
      });
      if (state.requestController !== requestController) return;
      if (!pageResponseMatchesCursor(state.data?.pagination?.next_cursor, requestedCursor)) continue;
      state.data = mergeSearchData(state.data, nextData);
      rememberViewData(state.data);
      if (state.data.items.length <= previousCount) break;
    }
    const reachablePages = resultPageCount(Math.min(availableResultCount(), state.data.items.length));
    state.currentPage = clampResultPage(targetPage, reachablePages);
  } catch (error) {
    if (error.name === 'AbortError') return;
    state.appendError = formatSourceMessage(error.message);
    $('#search-status').textContent = IS_GLOBAL ? `Could not load this page: ${state.appendError}` : `페이지를 불러오지 못했습니다: ${state.appendError}`;
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
  return MARKET_PROFILE !== 'global'
    && !state.showFavorites
    && !state.expansionExhausted
    && currentResultWindow() < SITE_RESULT_WINDOW_MAX
    && totalCount < SEARCH_SESSION_MAX_ITEMS
    && state.data != null;
}

async function expandResultWindow() {
  if (!canExpandResultWindow() || state.loading || state.viewCollectionController) return;
  const previousWindow = currentResultWindow();
  const previousCount = availableResultCount();
  const previousPage = state.currentPage;
  const nextWindow = Math.min(previousWindow + SITE_RESULT_WINDOW_STEP, SITE_RESULT_WINDOW_MAX);
  const requestController = new AbortController();
  state.requestController?.abort();
  state.requestController = requestController;
  const categoryIds = selectedCategoryIds();
  const sites = state.collectionSites.length ? [...state.collectionSites] : getSelectedSites(categoryIds, state.query);
  const viewSites = activeViewSites();
  const focusSites = viewSites.length ? viewSites : sites;
  state.appendError = '';
  $('#search-status').textContent = uiText('다음 매물을 더 찾는 중입니다.', 'Loading more listings.');
  $('#search-status').classList.add('visible');
  setLoading(true, true);
  try {
    let expanded = await requestSearchPage({
      keyword: state.query,
      categoryIds,
      sites,
      viewSites,
      focusSites,
      signal: requestController.signal,
      refreshIndex: false,
      siteWindow: nextWindow,
      expandIndex: true,
      acquisitionMode: 'recent'
    });
    if (state.requestController !== requestController) return;
    if (viewSites.length === 1) state.focusedSiteWindows[viewSites[0]] = nextWindow;
    else state.siteWindow = nextWindow;
    state.data = expanded;
    rememberViewData(expanded);
    const expandedCount = availableResultCount();
    const targetPage = expandedCount > previousCount
      ? Math.min(previousPage + 1, Math.max(0, resultPageCount(expandedCount) - 1))
      : previousPage;
    const targetItemCount = Math.min(expandedCount, (targetPage + 1) * RESULT_PAGE_SIZE);
    while ((state.data?.items || []).length < targetItemCount && state.data?.pagination?.next_cursor) {
      const nextData = await requestSearchPage({
        keyword: state.query,
        categoryIds,
        sites,
        viewSites,
        cursor: state.data.pagination.next_cursor,
        signal: requestController.signal,
        refreshIndex: false,
        siteWindow: nextWindow
      });
      if (state.requestController !== requestController) return;
      const before = state.data.items.length;
      state.data = mergeSearchData(state.data, nextData);
      rememberViewData(state.data);
      if (state.data.items.length <= before) break;
    }
    state.currentPage = clampResultPage(targetPage, resultPageCount(availableResultCount()));
    const addedCount = Math.max(0, availableResultCount() - previousCount);
    state.expansionExhausted = addedCount === 0 || nextWindow >= SITE_RESULT_WINDOW_MAX;
    $('#search-status').textContent = addedCount > 0
      ? IS_GLOBAL ? `Found ${addedCount} more ${addedCount === 1 ? 'listing' : 'listings'}.` : `새 매물 ${addedCount}개를 더 찾았습니다.`
      : uiText('추가로 확인된 매물이 없습니다.', 'No additional listings were found.');
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (viewSites.length === 1) state.focusedSiteWindows[viewSites[0]] = previousWindow;
    else state.siteWindow = previousWindow;
    state.appendError = formatSourceMessage(error.message);
    $('#search-status').textContent = IS_GLOBAL ? `Could not load more listings: ${state.appendError}` : `다음 매물을 찾지 못했습니다: ${state.appendError}`;
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
  if (IS_GLOBAL) {
    if (text.startsWith('SEARCH_BUSY:')) {
      const retryAfter = Number(text.slice('SEARCH_BUSY:'.length));
      return Number.isFinite(retryAfter) && retryAfter > 0
        ? `The search service is busy. Please try again in about ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}.`
        : 'The search service is busy. Please try again shortly.';
    }
    if (text.startsWith('CURSOR_EXPIRED:')) return 'These search results expired. Start a new search.';
    if (text.startsWith('CATEGORY_KEYWORD_FALLBACK:')) return 'The category name was used because a marketplace subcategory is unavailable.';
    if (text.startsWith('CATEGORY_PARENT_FALLBACK:')) return 'A verified parent category was used because a marketplace subcategory is unavailable.';
    if (text.startsWith('CATEGORY_KEYWORD_FILTER:') || text.startsWith('CATEGORY_TEXT_FILTER:') || text.startsWith('CATEGORY_SOURCE_FILTER:')) return 'Listings assigned to other categories were excluded.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return 'Could not connect to the search server. Try again.';
    if (text.startsWith('CATEGORY_COLLECTION_UNAVAILABLE:')) return 'This marketplace does not support that category yet.';
    if (/public search aggregated across \d+ areas/i.test(text)) return 'Public search results were combined across multiple areas.';
    if (text.startsWith('PAGINATION_UNAVAILABLE:')) return 'This marketplace does not provide a reliable next-page cursor.';
    if (text.startsWith('EBAY_SALE_STATUS_UNAVAILABLE')) return 'Check the original listing for its sale status.';
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
  if (text.startsWith('SEARCH_BUSY:')) {
    const retryAfter = Number(text.slice('SEARCH_BUSY:'.length));
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `검색 요청이 많습니다. 약 ${retryAfter}초 후 다시 시도해 주세요.`
      : '검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  }
  if (text.startsWith('CURSOR_EXPIRED:')) return '검색 결과가 만료됐습니다. 새로 검색해 주세요.';
  if (text.startsWith('CATEGORY_KEYWORD_FALLBACK:')) return '공식 세부분류가 없어 카테고리명으로 검색했습니다.';
  if (text.startsWith('CATEGORY_PARENT_FALLBACK:')) return '공식 세부분류가 없어 확인된 상위 카테고리 기준으로 조회했습니다.';
  if (text.startsWith('CATEGORY_KEYWORD_FILTER:') || text.startsWith('CATEGORY_TEXT_FILTER:')) return '다른 카테고리로 분류된 검색 결과를 제외했습니다.';
  if (text.startsWith('CATEGORY_SOURCE_FILTER:')) return '공식 분류 결과 중 다른 카테고리로 판정된 매물을 제외했습니다.';
  if (text.startsWith('BUNJANG_CATEGORY_API_ERROR:')) return '번개장터 공식 카테고리 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (text.startsWith('BUNJANG_SEARCH_API_ERROR:')) return '번개장터 검색 응답을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return '검색 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (/eBay Browse API token is not configured/i.test(text)) return 'eBay 공식 API 토큰이 설정되지 않았습니다. EBAY_BROWSE_API_TOKEN을 설정한 뒤 다시 시도해 주세요.';
  if (text.startsWith('CATEGORY_COLLECTION_UNAVAILABLE:')) return '이 사이트는 해당 카테고리 조회를 아직 지원하지 않습니다.';
  if (/public search aggregated across \d+ areas/i.test(text)) return '공개 검색 결과를 여러 지역에서 합산했습니다.';
  if (text.startsWith('PAGINATION_UNAVAILABLE:')) return '이 사이트는 안정적인 다음 페이지 커서를 제공하지 않아 현재 페이지까지만 표시합니다.';
  if (text.startsWith('EBAY_SALE_STATUS_UNAVAILABLE')) return '판매 상태는 원문에서 확인해 주세요.';
  if (text.startsWith('Dropped item due to weak keyword relevance:')) return '검색어와 관련성이 낮은 매물을 제외했습니다.';
  if (text.startsWith('Dropped item due to missing required fields')) return '필수 정보가 없는 매물을 제외했습니다.';
  if (text.startsWith('Dropped duplicate URL:')) return '중복 매물을 하나로 합쳤습니다.';
  if (text.startsWith('BLOCKED_PAGE:') || /blocked page detected|access challenge/i.test(text)) return '사이트가 자동 수집을 제한해 결과를 확인하지 못했습니다. 잠시 후 다시 시도하거나 원문 사이트에서 직접 확인해 주세요.';
  if (text.startsWith('BROWSER_RUNTIME_UNAVAILABLE:')) return '브라우저 연결이 없어 이 사이트를 조회하지 못했습니다. 수집 환경을 확인해 주세요.';
  if (text.startsWith('EMPTY_RESULTS:')) return '사이트 응답에서 매물 목록을 찾지 못했습니다. 검색 결과가 없거나 사이트 구조가 바뀌었을 수 있습니다.';
  if (text.startsWith('UNSUPPORTED_EVIDENCE_SHAPE:')) return '사이트 응답 형식이 현재 수집 규칙과 달라 결과를 확인하지 못했습니다.';
  if (text.startsWith('SELECTOR_DRIFT:')) return '사이트 화면 구조가 바뀌어 매물 필드를 읽지 못했습니다. 수집 규칙 점검이 필요합니다.';
  if (text.startsWith('SEARCH_EXTRACTION_FAILED:')) return '사이트 매물 추출 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  if (text.startsWith('EBAY_BROWSE_API_ERROR:')) return 'eBay 공식 API를 확인하지 못했습니다. API 인증과 연결 상태를 점검해 주세요.';
  if (text.startsWith('EBAY_BROWSE_API_EMPTY:')) return 'eBay 공식 API에서 검색 결과가 없습니다.';
  if (text.startsWith('LOGIN_STATE_UNCLEAR:')) return '사이트 로그인 상태를 확인하지 못했습니다.';
  if (text.startsWith('No search rows matched selector:') || text.startsWith('Browser-first extraction unavailable') || text.startsWith('Unsupported evidence shape for')) return '사이트에서 검색 목록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  if (text.startsWith('Selectors prepared:') || text.startsWith('Adapter notes:')) return '사이트별 수집 규칙 점검이 필요합니다.';
  if (text.startsWith('Keyword fallback was not used')) return '카테고리 매핑이 없어 검색을 실행하지 못했습니다.';
  if (text === 'Internal error' || text.startsWith('Internal error')) return '검색 서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  return text;
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
  if (state.showFavorites && hasPriceRange && !state.priceFilterIgnored) {
    items = items.filter((item) => typeof item.price === 'number'
      && (minPrice === null || item.price >= minPrice)
      && (maxPrice === null || item.price <= maxPrice));
  }
  // 정렬 탭은 현재 세션의 결과 배열만 바꾼다. 원 사이트 재수집은 사이트 보강에서만 수행한다.
  if (state.sort === 'price_asc') {
    items.sort((a, b) => sortablePrice(a, Number.MAX_SAFE_INTEGER) - sortablePrice(b, Number.MAX_SAFE_INTEGER));
  }
  if (state.sort === 'price_desc') {
    items.sort((a, b) => sortablePrice(b, Number.NEGATIVE_INFINITY) - sortablePrice(a, Number.NEGATIVE_INFINITY));
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
  return prioritizeImageResults(items);
}

function sortablePrice(item, missingValue) {
  const price = Number(item?.price);
  return Number.isFinite(price) && price > 100 ? price : missingValue;
}

function availableResultCount(data = state.data) {
  if (state.showFavorites && data === state.data) return filteredItems().length;
  const availableCount = Number(data?.quality?.available_count);
  return Number.isFinite(availableCount)
    ? Math.min(Math.max(0, availableCount), SEARCH_SESSION_MAX_ITEMS)
    : Math.min((data?.items || []).length, SEARCH_SESSION_MAX_ITEMS);
}

function visibleItems() {
  const items = filteredItems();
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
  const loadedCount = Array.isArray(state.data?.items) ? state.data.items.length : 0;
  const maxNavigablePage = maxNavigableResultPage(loadedCount, totalCount, Boolean(state.data?.pagination?.next_cursor));
  const pageButtons = paginationItems(state.currentPage, pageCount).map((item, index) => {
    if (item === 'ellipsis') return `<span class="pagination-ellipsis" aria-hidden="true" data-pagination-gap="${index}">…</span>`;
    const label = IS_GLOBAL ? `Page ${item + 1}` : `${item + 1}페이지`;
    if (item > maxNavigablePage) return `<span class="pagination-page-preview" aria-label="${label}">${item + 1}</span>`;
    return `<button class="pagination-page" type="button" data-result-page="${item}" aria-label="${label}"${item === state.currentPage ? ' aria-current="page" disabled' : ''}>${item + 1}</button>`;
  }).join('');
  const atLastPage = pageCount <= 1 || state.currentPage >= pageCount - 1;
  const nextLoadsMore = atLastPage && canExpand;
  const nextUnavailable = !nextLoadsMore && (atLastPage || state.currentPage + 1 > maxNavigablePage);
  const controlsBusy = state.loading || Boolean(state.viewCollectionController);
  const nextAction = nextLoadsMore ? 'data-expand-results' : `data-result-page="${state.currentPage + 1}"`;
  root.innerHTML = `<button class="pagination-direction" type="button" data-result-page="${state.currentPage - 1}" aria-label="${uiText('이전 페이지', 'Previous page')}"${state.currentPage === 0 || controlsBusy ? ' disabled' : ''}>${uiText('이전', 'Previous')}</button>${pageButtons}<button class="pagination-direction" type="button" ${nextAction} aria-label="${uiText('다음 페이지', 'Next page')}"${nextUnavailable || controlsBusy ? ' disabled' : ''}>${uiText('다음', 'Next')}</button>`;
  root.hidden = false;
}

function focusCurrentPage() {
  requestAnimationFrame(() => {
    $('#pagination-controls [aria-current="page"]')?.focus({ preventScroll: true });
    $('.results-toolbar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function bindThumbnailFallbacks() {
  document.querySelectorAll('#result-list .item-thumb').forEach((image) => {
    image.addEventListener('error', () => {
      image.hidden = true;
      const fallback = image.nextElementSibling;
      if (fallback) fallback.hidden = false;
      if (IS_GLOBAL || state.showFavorites || state.sort !== 'recommended') return;
      const row = image.closest('.item-row');
      if (!row || row.dataset.imageFailed === 'true' || !row.parentElement) return;
      row.dataset.imageFailed = 'true';
      row.parentElement.append(row);
    }, { once: true });
  });
}

function thumbnailMarkup(item) {
  const imageUrl = safeImageUrl(item.image_url);
  const listingUrl = safeListingUrl(item);
  const fallback = `<div class="item-thumb-fallback" hidden>${uiText('이미지 없음', 'Image unavailable')}</div>`;
  const key = escapeHtml(favoriteKey(item));
  const saved = state.favorites.has(favoriteKey(item));
  const thumbnail = `<div class="item-thumb-wrap">${imageUrl ? `<img class="item-thumb" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ''}${imageUrl ? fallback : `<div class="item-thumb-fallback">${uiText('이미지 없음', 'Image unavailable')}</div>`}</div>`;
  const media = listingUrl
    ? `<a class="item-thumb-link" href="${escapeHtml(listingUrl)}" target="_blank" rel="noreferrer noopener" aria-label="${uiText('매물 원문 열기', 'Open original listing')}" data-item-key="${key}">${thumbnail}</a>`
    : `<span class="item-thumb-link" aria-hidden="true">${thumbnail}</span>`;
  return `<div class="item-media">${media}<button class="heart-button${saved ? ' saved' : ''}" type="button" data-favorite="${key}" aria-label="${saved ? uiText('찜 해제', 'Remove saved item') : uiText('찜', 'Save item')}" aria-pressed="${saved}">${saved ? '♥' : '♡'}</button></div>`;
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
  root.innerHTML = expectedSites.map((site) => {
    const source = sourceByKey.get(site) || { key: site, status: 'empty', count: 0 };
    const count = sourceCount(source);
    const unavailable = !count && source.data_source === 'unavailable' && !(source.errors || []).length;
    const filterWarning = (source.warnings || []).some((warningText) => /키워드 조건|카테고리 조건/.test(String(warningText)));
    const suggested = (source.warnings || []).some((warningText) => /추천 검색어|UPSTREAM_SUGGESTED_KEYWORD/.test(String(warningText)));
    const suggestedKeyword = (source.warnings || [])
      .map((warningText) => String(warningText).match(/UPSTREAM_SUGGESTED_KEYWORD:(.+)$/)?.[1]?.trim() || '')
      .find(Boolean) || '';
    const suggestedLabel = suggestedKeyword ? `${uiText('추천어', 'Suggested')}: ${suggestedKeyword}` : uiText('추천어', 'Suggested');
    const rateLimited = source.data_source === 'rate_limited';
    const failure = (sourceHasFailure(source) || rateLimited) && !unavailable;
    const partial = Boolean(count && (failure
      || source.collection_state === 'partial'
      || source.status === 'warning'
      || Number(source.filtered_count) > 0));
    const statusText = failure && !count
      ? rateLimited ? uiText('원 사이트 접속 제한', 'Marketplace access limited') : uiText('원 사이트 확인 실패', 'Marketplace unavailable')
      : partial ? IS_GLOBAL ? `${count} ${count === 1 ? 'result' : 'results'} · Partial` : `${count}개 · 일부 확인`
      : filterWarning && count ? IS_GLOBAL ? `${count} ${count === 1 ? 'result' : 'results'} · Filtered` : `${count}개 · 조건 적용`
          : suggested ? (count ? IS_GLOBAL ? `${count} ${count === 1 ? 'result' : 'results'} · ${suggestedLabel}` : `${count}개 · ${suggestedLabel}` : suggestedLabel)
            : count ? IS_GLOBAL ? `${count} ${count === 1 ? 'result' : 'results'}` : `${count}개` : uiText('결과 없음', 'No results');
    const statusClass = failure || partial ? 'is-warning' : count ? '' : 'is-empty';
    const detail = failure || partial ? uiText('원 사이트 응답 중 확인 가능한 매물만 표시합니다.', 'Showing only listings that could be verified from this marketplace.') : '';
    return `<span class="source-summary-item ${statusClass}" title="${escapeHtml(detail)}">${escapeHtml(labels[site] || site)} ${escapeHtml(statusText)}</span>`;
  }).join('');
}

function renderResults() {
  const items = visibleItems();
  const availableCount = availableResultCount();
  const pageCount = resultPageCount(availableCount);
  const pageText = pageCount > 1 ? IS_GLOBAL ? ` · Page ${state.currentPage + 1} of ${pageCount}` : ` · ${state.currentPage + 1}/${pageCount}페이지` : '';
  $('#result-count').textContent = IS_GLOBAL
    ? `${availableCount} ${availableCount === 1 ? 'result' : 'results'}${pageText}`
    : `총 ${availableCount}개${pageText}`;
  renderPagination(availableCount);
  renderSourceSummary();
  renderControlNotice();
  updateResultControls();
  if (!items.length) {
    $('#result-list').innerHTML = `<div class="empty-state" role="status"><span>${uiText('결과 없음', 'No results')}</span></div>`;
    return;
  }
  $('#result-list').innerHTML = items.map((item) => {
    const warning = item.price_suspect || item.quality_suspect || (item.fraud_risk != null && item.fraud_risk > .45);
    const comparison = formatMarketComparison(item);
    const flag = warning ? `<span class="item-flag">${uiText('확인', 'Review')}</span>` : item.noise_filtered ? `<span class="item-flag">${escapeHtml(formatNoiseReason(item.noise_filter_reason))}</span>` : '';
    const listingTag = (IS_GLOBAL ? { part: 'Parts', full_pc: 'Device', bundle: 'Bundle' } : { part: '부품', full_pc: '본체', bundle: '묶음' })[item.listing_type] || '';
    const shipping = formatShipping(item.shipping);
    const tag = shipping || listingTag;
    const priceLabel = formatPriceLabel(item.price_label);
    const feeNote = item.site === 'vinted' ? uiText('구매자 수수료 별도', 'Buyer protection fee may apply') : '';
    const priceHint = [priceLabel, comparison, feeNote].filter(Boolean).join(' · ');
    const itemKey = escapeHtml(favoriteKey(item));
    const sourceLabel = labels[item.site] || uiText('출처 미상', 'Unknown source');
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
  bindThumbnailFallbacks();
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
      warnings: Array.from(new Set([...(previous.quality?.warnings || []), ...(next.quality?.warnings || [])])).slice(0, 8)
    }
  };
}

function canonicalItemKey(item) {
  const rawUrl = String(item.url || '').trim();
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (/^(?:m\.)?bunjang\.co\.kr$/i.test(url.hostname) && /^\/products\/\d+$/i.test(url.pathname)) {
      return `bunjang:${url.pathname}`;
    }
  } catch {
    // Fall through to the stable item identifier.
  }
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
    toggle.setAttribute('aria-label', expanded ? '하위 카테고리 펼치기' : '하위 카테고리 접기');
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
  const shouldSearch = Boolean(state.data || state.loading);
  if (shouldSearch) {
    cancelPendingSearch();
    executeSearch({ keyword: state.query, categoryId: state.categoryId, categoryIds: selectedCategoryIds(), reason: 'price_filter' });
  }
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
$$('[data-sort]').forEach((tab) => tab.addEventListener('click', async () => {
  if (state.loading) return;
  const nextSort = tab.dataset.sort || 'recommended';
  if (nextSort === state.sort) return;
  state.sort = nextSort;
  state.currentPage = 0;
  updateSortTabs();
  const shouldSearch = Boolean(state.data || state.loading);
  if (shouldSearch) {
    renderAll();
    cancelPendingSearch();
    await executeSearch({ keyword: state.query, categoryId: state.categoryId, categoryIds: selectedCategoryIds(), reason: 'sort' });
  }
}));
$('#result-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-favorite]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  toggleFavorite(button);
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
    cancelPendingSearch();
    executeSearch({ keyword: state.query, categoryId: state.categoryId, categoryIds: selectedCategoryIds(), reason: 'price_filter' });
  }
});
$('#apply-refresh-results').addEventListener('click', () => {
  if (!state.pendingRefreshData) return;
  const applyingStale = state.pendingResultKind === 'stale';
  state.data = state.pendingRefreshData;
  state.pendingRefreshData = null;
  state.pendingResultKind = '';
  if (applyingStale) state.refreshMessage = `${formatCheckedAge(state.data?.freshness)} · ${uiText('오래된 결과 표시', 'Showing saved results')}`;
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
