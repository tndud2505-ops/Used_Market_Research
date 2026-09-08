export const COUPANG_COMMISSION_DISCLOSURE = "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";
const SLOT = "after-organic-results";

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
    const heading = document.createElement("h3");
    heading.className = "affiliate-heading";
    heading.textContent = `광고 · ${offer.provider}`;
    const disclosure = document.createElement("p");
    disclosure.className = "affiliate-disclosure";
    disclosure.textContent = offer.disclosure.commission;
    const link = document.createElement("a");
    link.className = "affiliate-link";
    link.href = offer.destination_url;
    link.target = "_blank";
    link.rel = "sponsored noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    link.textContent = `${offer.cta_label} ↗`;
    link.setAttribute("aria-label", `${offer.title} 보기 · 새 창`);
    link.addEventListener("click", () => record("click", offer));
    const note = document.createElement("p");
    note.className = "affiliate-note";
    note.textContent = `${offer.context_type === "category" && context.canonical_product_id
      ? "부품군 전체 상품이며 선택 모델과 다를 수 있습니다. " : ""}${offer.disclosure.independence}`;
    root.replaceChildren(heading, disclosure, link, note);
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
