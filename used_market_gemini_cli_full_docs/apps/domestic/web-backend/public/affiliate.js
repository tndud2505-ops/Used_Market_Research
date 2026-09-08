export const COUPANG_COMMISSION_DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";
const SLOT = "after-organic-results";

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  return element;
}

function categoryPartIcon(categoryCode) {
  const code = String(categoryCode || "CPU").trim().toUpperCase();
  const icon = svgElement("svg", {
    class: "affiliate-icon affiliate-part-icon",
    viewBox: "0 0 32 32",
    "aria-hidden": "true",
    "data-category": code,
  });
  const append = (...nodes) => icon.append(...nodes);
  if (code === "GPU") {
    append(
      svgElement("rect", { x: 3, y: 8, width: 24, height: 16, rx: 2 }),
      svgElement("circle", { cx: 11, cy: 16, r: 5 }),
      svgElement("circle", { cx: 21, cy: 16, r: 3.5 }),
      svgElement("path", { d: "M27 11h3v10h-3M7 24v3h15" }),
    );
  } else if (code === "RAM") {
    append(
      svgElement("rect", { x: 3, y: 9, width: 26, height: 14, rx: 2 }),
      svgElement("path", { d: "M7 13h4v6H7zM14 13h4v6h-4zM21 13h4v6h-4zM7 23v3M11 23v3M15 23v3M19 23v3M23 23v3" }),
    );
  } else if (code === "MOTHERBOARD") {
    append(
      svgElement("rect", { x: 5, y: 3, width: 22, height: 26, rx: 2 }),
      svgElement("rect", { x: 9, y: 7, width: 9, height: 9, rx: 1 }),
      svgElement("path", { d: "M21 7h3M21 11h3M21 15h3M9 20h15M9 24h11" }),
      svgElement("circle", { cx: 23, cy: 25, r: 1.5 }),
    );
  } else if (code === "SSD") {
    append(
      svgElement("rect", { x: 7, y: 3, width: 18, height: 26, rx: 3 }),
      svgElement("path", { d: "M11 9h10M11 13h10M11 18h6" }),
      svgElement("circle", { cx: 11, cy: 24, r: 1.5 }),
      svgElement("circle", { cx: 21, cy: 24, r: 1.5 }),
    );
  } else if (code === "HDD") {
    append(
      svgElement("rect", { x: 6, y: 3, width: 20, height: 26, rx: 3 }),
      svgElement("circle", { cx: 16, cy: 15, r: 7 }),
      svgElement("circle", { cx: 16, cy: 15, r: 1.5 }),
      svgElement("path", { d: "M17 16l5 5M10 25h12" }),
    );
  } else if (code === "PSU") {
    append(
      svgElement("rect", { x: 3, y: 6, width: 26, height: 20, rx: 2 }),
      svgElement("circle", { cx: 13, cy: 16, r: 7 }),
      svgElement("circle", { cx: 13, cy: 16, r: 3 }),
      svgElement("path", { d: "M6 16h14M13 9v14M23 11h3v4h-3M23 19h3" }),
    );
  } else {
    append(
      svgElement("rect", { x: 8, y: 8, width: 16, height: 16, rx: 3 }),
      svgElement("rect", { x: 12, y: 12, width: 8, height: 8, rx: 1 }),
      svgElement("path", { d: "M11 3v5M16 3v5M21 3v5M11 24v5M16 24v5M21 24v5M3 11h5M3 16h5M3 21h5M24 11h5M24 16h5M24 21h5" }),
    );
  }
  return icon;
}

export function validContextualOffer(offer, context, now = Date.now()) {
  if (!offer || offer.provider !== "쿠팡 파트너스" || offer.slot !== SLOT) return false;
  if (!/^[a-z0-9][a-z0-9._:-]{0,119}$/u.test(offer.offer_id || "")) return false;
  const matches = offer.context_type === "canonical_product"
    ? Boolean(context.canonical_product_id) && offer.context_key === context.canonical_product_id
    : offer.context_type === "category" && Boolean(context.category_code) && offer.context_key === context.category_code;
  if (!matches || !offer.title || !offer.cta_label) return false;
  if (offer.disclosure?.advertisement !== "광고"
    || offer.disclosure?.commission !== COUPANG_COMMISSION_DISCLOSURE
    || !offer.disclosure?.independence) return false;
  if (!Number.isFinite(Date.parse(offer.expires_at)) || Date.parse(offer.expires_at) <= now) return false;
  if (!Number.isFinite(Date.parse(offer.event_token_expires_at)) || Date.parse(offer.event_token_expires_at) <= now
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(offer.event_token || "")) return false;
  try {
    const url = new URL(offer.destination_url);
    return url.origin === "https://link.coupang.com" && /^\/a\/[A-Za-z0-9]+$/u.test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function createContextualAffiliate(root, { now = Date.now } = {}) {
  let controller = null;
  let observer = null;
  let scopeKey = "";
  let displayedOffer = null;
  let sentEvents = new Set();

  function clear() {
    controller?.abort();
    controller = null;
    observer?.disconnect();
    observer = null;
    scopeKey = "";
    displayedOffer = null;
    sentEvents = new Set();
    root.hidden = true;
    root.replaceChildren();
  }

  function record(eventType, offer) {
    if (displayedOffer !== offer || sentEvents.has(eventType)
      || Date.parse(offer.event_token_expires_at) <= now()) return;
    sentEvents.add(eventType);
    // Analytics never delays navigation and contains no raw search or browser identifiers.
    void fetch("/api/monetization/event", {
      method: "POST",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        event_type: eventType, offer_id: offer.offer_id, slot: SLOT,
        context_type: offer.context_type, context_key: offer.context_key, event_token: offer.event_token,
      }),
    }).catch(() => {});
  }

  function render(offer, context) {
    const main = document.createElement("div");
    main.className = "affiliate-main";
    const icon = categoryPartIcon(context.category_code);
    const copy = document.createElement("div");
    copy.className = "affiliate-copy";
    const heading = document.createElement("span");
    heading.className = "affiliate-heading";
    heading.textContent = `광고 · ${offer.provider}`;
    const link = document.createElement("a");
    link.className = "affiliate-link";
    link.href = offer.destination_url;
    link.target = "_blank";
    link.rel = "sponsored noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    link.textContent = `${offer.cta_label} →`;
    link.setAttribute("aria-label", `광고 · ${offer.provider} · ${offer.title} 보기 · 새 창`);
    link.addEventListener("click", () => record("click", offer));
    copy.append(heading, link);
    main.append(icon, copy);
    const disclosure = document.createElement("p");
    disclosure.className = "affiliate-disclosure";
    disclosure.textContent = `${offer.disclosure.commission} ${offer.context_type === "category" && context.canonical_product_id
      ? "선택 모델과 다른 상품이 포함될 수 있습니다. " : ""}${offer.disclosure.independence}`;
    root.replaceChildren(main, disclosure);
    root.hidden = false;
    displayedOffer = offer;
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver((entries) => {
        if (displayedOffer !== offer) return;
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)) {
          record("impression", offer);
          observer?.disconnect();
        }
      }, { threshold: 0.5 });
      observer.observe(root);
    }
  }

  async function update({ hasResults, canonical_product_id = "", category_code = "" }) {
    if (!hasResults || (!canonical_product_id && !category_code)) {
      clear();
      return;
    }
    const context = { slot: SLOT };
    if (canonical_product_id) context.canonical_product_id = canonical_product_id;
    if (category_code) context.category_code = category_code;
    const nextKey = JSON.stringify(context);
    if (scopeKey === nextKey && (controller || displayedOffer)) return;
    clear();
    scopeKey = nextKey;
    const request = new AbortController();
    controller = request;
    try {
      const response = await fetch("/api/monetization/contextual-offer", {
        method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        body: JSON.stringify(context),
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (controller !== request || request.signal.aborted || scopeKey !== nextKey) return;
      const offer = payload?.ok === true ? payload.data?.offer : null;
      if (validContextualOffer(offer, context, now())) render(offer, context);
    } catch {
      // An unavailable or unapproved advertisement must not affect the listings.
    } finally {
      if (controller === request) controller = null;
    }
  }

  return { clear, update };
}
