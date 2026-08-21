# Global harness

This harness belongs only to the Japan and United States application.

```bash
npm test
npm run test:ui
npm run us:matrix:live
node harness/ops-deployment-contract.mjs
```

Coverage:

- seven configured marketplace adapters and owned HTML fixtures
- English Japan and United States UI states
- country, price range, and sorting controls
- cache behavior and result ordering
- runtime route boundary under `/global/`
- source, document, harness, and deployment reference isolation
- wiki, marketplace-matrix, source-policy, and deployment-fact drift checks
- dedicated Nginx routing and retention units
- United States 4-source policy, pagination, relevance, and aggregate-only live matrix
- server-session policy: authoritative 30-row pages, 1,000-row cap, server-enforced 160-row window steps, loaded-site reuse, source error detail, and coherent full-session retry

The live United States matrix runs three representative queries against each of the four sources, respects HTTP 429, and stores aggregate counts and rates only. It follows one real continuation cursor when available, rejects cursor regressions and cross-page duplicates, requires usable results from every source, and requires pagination evidence for eBay, Vinted, and Unclaimed Baggage. It never stores listing rows, URLs, seller data, or eBay item identifiers. No deployment happens from a harness. Live source availability remains operational evidence because marketplace access controls can change independently.
