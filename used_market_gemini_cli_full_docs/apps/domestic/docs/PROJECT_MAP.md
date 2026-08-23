# Project Map

| 작업 | 코드 | 검증 |
| --- | --- | --- |
| 사이트 검색 | `collector/logic/sites/`, `collector/logic/browserCollector.ts` | live harness |
| 검색 세션·사이트 보기·정렬·페이지 | `web-backend/public/app.js`, `web-backend/public/pagination.mjs`, `cloudflare/live-search.mjs`, `aws-runner/search-index.mjs`, `aws-runner/runner.mjs` | `npm run search-session:contract`, `node harness/ui-pagination-contract.mjs`, `npm run index:harness`; 정책은 `docs/wiki/08-cache-search-ux.md` |
| 카테고리 연결 | `market/logic/category-catalog.ts`, `market/logic/category-harness.ts` | `npm run category:harness`, `npm run category:live` |
| 부품 정규화 | `market/logic/componentCatalog.ts`, `market/logic/normalize.ts` | `npm test`, live harness |
| 가격 snapshot/그래프 | `market/logic/history-reader.ts`, `web-backend/logic/price-history-service.ts`, `web-backend/public/app.js` | API 응답의 `price_history` |
| UI | `web-backend/public/index.html`, `styles.css`, `app.js` | 브라우저 desktop/mobile QA |
| 스케줄러 | `scheduler/logic/jobs.ts`, `job-runner.ts`, `daemon.ts` | scheduler smoke |
| Cloudflare | `cloudflare/worker.mjs`, `wrangler.jsonc` | `npm run cloudflare:harness` |
| 피드백 | `web-backend/logic/feedback-service.ts` | `/api/feedback/summary` |

먼저 코드를 읽고, 그 다음 위키의 해당 문서에서 확인된 사실·추가 위험·운영 전제를 확인한다.
