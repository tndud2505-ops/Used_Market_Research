# GA4 production installation — 2026-10-05 KST

## Cause and deployment source

The live Worker was Wrangler version `a5ccac39-2c3e-4535-9967-7607ddd2c318`, after Dashboard version `6e48bcb9` and Wrangler `5ed816d2`. Its repository source had no GA4 installation. `cloudflare/wrangler.jsonc` only ran the Worker before assets for `/` and `/index.html`; other static HTML bypassed Worker handling. Home and category assets returned `CF-Cache-Status: HIT` with the original CSP and no tag. This header describes the asset cache and is not proof that the entire Worker was bypassed.

## Change

- Common final HTML handling in `cloudflare/html-analytics.mjs`; initialize measurement `G-2L2ETG06B1` through `/analytics.js` exactly once per document.
- Worker-first paths cover home, HTML files, and category routes. Successful HTML documents are transformed after asset/cache routing. API, binary, error, redirect and exact Search Console verification responses remain unchanged.
- Preserve existing CSP sources/directives; add Google tag and www/region1 GA collection hosts. Disable Google signals and advertising personalization in initialization. Update the privacy notice.
- Strip original HTML conditional validators before asset fetch; clear obsolete encoding/length/validators after transformation and require public HTML revalidation while preserving existing private/no-store restrictions. No zone purge, API cache reset, statistics refresh, AWS change, or historical recalculation.
- Release checks now reject a home or analysis page missing the common tag/CSP. See [Worker runbook](../../cloudflare/README.md#htmlga4-운영-경로).

## Evidence

- `scripts/verify.ps1`: deterministic suite passed; updated HTML analytics contract passed independently after the verification-file exclusion.
- Wrangler dry-run passed. `npm run cloudflare:app-release` exited 0, final version `4d80995b-2375-46d6-a8ca-7582408b508f`; both public domains healthy.
- Query-free home, index, categories, GPU category, guide, analysis, builder, privacy and terms returned HTTP 200 with exactly one tag and bootstrap, updated CSP, no ETag, and revalidation. Home and multiple internal pages still reported asset-cache HIT, proving transformation also runs after cache hits. Sending the old home ETag returned a newly transformed HTTP 200.
- `/api/categories`, `/analytics.js`, SVG and Search Console verification body retained their types/payloads. Verification body matched the repository file exactly.
- Chrome observed `gtag/js?id=G-2L2ETG06B1` and resource requests to `www.google-analytics.com/g/collect` with `tid=G-2L2ETG06B1`, `en=page_view` on home and `/guide.html`. No browser console errors or CSP violations on those pages.
- GA4 property `used-pick.com` (`557285003`) showed zero real-time users before the deployment. Final report confirmation is pending: reloading Analytics and opening its standard report URL returned browser `ERR_FAILED`. Browser collection is verified; real-time ingestion is not yet claimed. No credentials or authentication codes were requested.

References: [Cloudflare Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/), [Google tag CSP](https://developers.google.com/tag-platform/security/guides/csp).
