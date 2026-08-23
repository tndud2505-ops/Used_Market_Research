# Global pagination UX verification — 2026-08-24

## Scope

This change belongs only to `apps/global`. It does not modify, import, test, or deploy the domestic application.

## User-visible contract

- Search results render 30 listings per page.
- The browser preloads session-only pages 2 and 3 when they are available.
- A loaded page opens from the generation-bound browser cache without another search request.
- Selecting the one page immediately beyond the authoritative result window performs exactly one session or cursor request.
- `Previous` and `Next` remain available around the numbered controls.
- More than seven loaded/reachable pages are compacted to the first page, the current-page neighborhood, the last authoritative loaded page, and the immediately reachable next page, with ellipses for gaps.
- The 640-row source-window capacity is never shown as an actual result total.
- A session-generation change discards cached pages. An unfilled target page keeps the current page visible. Completed page movement focuses the result count.
- At 320px, the page controls retain 40px targets, stay within two rows in the long-result fixture, and do not create horizontal page overflow.

## Deterministic verification

- `npm test`: passed.
- `npm run test:ui`: 48 base UI checks and 132 English/responsive/session checks passed.
- Cached page 1 → page 3: zero additional requests.
- Immediate next page: one cursor request.
- Long fixture: `1 2 … 9 10`, two control rows, no horizontal overflow.
- Browser console errors in the deterministic UI harness: zero.

## Production verification

- Cloudflare Worker: `used-market-global`.
- Custom domain: `https://global.used-pick.com/global/`.
- Deployed version: `b1bf9b6d-aabf-4ab9-aa05-88ecae397027`.
- Release gate confirmed Worker health, private runner availability, 32 categories, and a real runner-backed search response.
- In-app browser confirmed `app.js?v=global-pagination-v6` and `styles.css?v=global-pagination-v4`.
- A live United States aggregate search exposed `Previous`, pages 1–3, one reachable page 4, locked continuation, and `Next`. Page 3 opened directly; page 4 expanded the authoritative window; both transitions focused `result-count`.
- At the actual 320px browser viewport, `documentElement.scrollWidth`, `clientWidth`, and `body.scrollWidth` were all 305px after accounting for the vertical scrollbar, confirming no horizontal overflow.

Live source counts and partial-source warnings are transient marketplace conditions and are not product-total claims.
