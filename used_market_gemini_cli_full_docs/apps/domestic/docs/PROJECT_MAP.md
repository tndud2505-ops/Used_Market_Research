# Project Map

| 작업 | 코드 | 검증 |
| --- | --- | --- |
| 승인 사이트 검색 | `collector/logic/sites/`, `collector/logic/browserCollector.ts`, `collector/logic/pc-source-registry.mjs` | 운영자 승인 canary |
| eBay 공식 API | `collector/logic/publicSearchExtractors.ts`, `cloudflare/live-search.mjs` | `node harness/pc-source-policy-contract.mjs` |
| 검색 projection·서명 cursor | `cloudflare/live-search.mjs`, `aws-runner/search-index.mjs`, `aws-runner/runner.mjs` | `node harness/pc-service-contract.mjs` |
| 공개 카테고리 | `market/logic/category-catalog.ts`, `web-backend/public/app.js` | `node harness/pc-service-contract.mjs` |
| PC 제품 디렉터리 | `market/logic/pc-parts-directory.mjs`, `market/data/pc-product-master-v2.mjs` | `node harness/pc-directory-contract.mjs` |
| 사전수집 공개 API | `aws-runner/runner.mjs`, `cloudflare/worker.mjs`, `web-backend/logic/server.ts` | `node harness/pc-service-contract.mjs` |
| 부품 정규화 | `market/logic/componentCatalog.ts`, `market/logic/normalize.ts` | `node harness/pc-domain-contract.mjs` |
| PC 부품 exact 분류 | `market/logic/pc-parts-classifier.mjs`, `harness/fixtures/pc-parts-cases.json` | `node harness/pc-domain-contract.mjs` |
| PC 원장·상태·30일 통계 | `aws-runner/pc-parts-ledger.mjs` | `node harness/pc-domain-contract.mjs` |
| PC 소스 정책 | `collector/logic/pc-source-registry.mjs`, `collector/logic/pc-source-adapters.mjs` | `node harness/pc-source-policy-contract.mjs` |
| 가격 snapshot/그래프 | `market/logic/history-reader.ts`, `web-backend/logic/price-history-service.ts`, `web-backend/public/app.js` | API 응답의 `price_history` |
| 공개 제품 통계 | `aws-runner/pc-price-stats-http.mjs`, `cloudflare/public-product-stats.mjs`, `cloudflare/migrations/0002_pc_public_stats.sql` | `node harness/pc-publication-contract.mjs` |
| 통계 계산·분할 업로드 | `aws-runner/publish-pc-stats-runner.mjs`, `aws-runner/pc-stats-publication-client.mjs` | `npm run test:pc-release` |
| AWS 전체 검증·Worker 활성화 | `aws-runner/pc-stats-readback.mjs`, `cloudflare/pc-stats-runner-verification.mjs`, `cloudflare/public-product-stats.mjs` | `node harness/pc-agent1-chunk-integrity-contract.mjs` |
| UI·수익화 경계 | `web-backend/public/index.html`, `styles.css`, `app.js` | `node harness/pc-service-contract.mjs` |
| AWS PC 스케줄러 | `aws-runner/runner.mjs`, `collector/logic/pc-source-registry.mjs` | `node harness/pc-source-policy-contract.mjs` |
| Cloudflare | `cloudflare/worker.mjs`, `wrangler.jsonc` | `npm run cloudflare:harness` |
| 피드백 | `web-backend/logic/feedback-service.ts` | `/api/feedback/summary` |

먼저 코드를 읽고, 그 다음 위키의 해당 문서에서 확인된 사실·추가 위험·운영 전제를 확인한다.

통계가 오래됐거나 CPU 초과·게시 실패가 발생하면 [게시 운영 위키](wiki/09-price-publication-operations.md) → [2026-09-24 장애 기록](worklog/2026-09-24-aws-publication-verification.md) 순서로 읽는다. 기록된 당시 게시 ID를 현재 ID로 가정하지 않는다.
