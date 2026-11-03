# Mobile price tools — 2026-11-02

References: analysis-concept.png and builder-concept.png, generated with ImageGen. Render evidence: analysis-render.png and builder-render.png, native IAB screenshots at 390 × 844. Additional responsive checks: 320 × 740 and desktop 1280 × 900. Concept images use larger raster dimensions; their logical mobile layout was compared at 390px. Both concepts and latest screenshots were inspected with view_image in the same QA pass.

| Comparison | Result / intentional change |
| --- | --- |
| Header and palette | White background, existing USED PICK brand asset, orange accent, small menu; no additional card containers or shadows. Existing brand icon retained. |
| Analysis controls | Model, source, price kind, listings action fit one row. Full product identity remains accessible; mobile name removes known vendor prefixes only. |
| Source prices | Moved above the chart in three compact columns per the user's latest direction. Source checks and prices share one area; duplicate lower legend removed. |
| Chart typography and gestures | Left axis 10px with Korean compact units and smaller gutter. No plus, minus, reset toolbar. One expand icon. Fullscreen positioning specificity fixed after browser QA. |
| Data and chart shape | Real stored observations, gaps, source currencies and sample qualifiers retained, so plotted shape and values intentionally differ from illustrative concept. USD selection was checked separately. |
| Builder density | Seven open table rows, selected model, quantity, one price, menu. Empty rows use shorter height. No nested cards, repeated per-row price-kind captions or placeholder prices. |
| Builder actions | Existing save and print retained rather than inventing a new action flow. Check selection sheet works. Compatibility alerts remain visible through a warning menu indicator when required. |
| Mobile picker | Circle check controls, native dialog, no horizontal overflow. Fixed higher-specificity desktop button rules that initially caused clipping. |

Visible-copy review: no marketing or generic helper copy added. Names shortened only for visual fit. Existing sample/date and sold-price qualifiers retained where needed to avoid misrepresenting prices. The source readout moved to the top by explicit user request. Price labels and totals use actual data, not concept examples.

Core browser paths verified: choose a Ryzen 5 5600, switch active/sold display and totals, reopen model picker, remove the QA-only entry to restore the empty local configuration; analysis active/sold radio sheet, domestic/eBay selection and return, expanded chart and close. Dialog closes restore body scroll. Desktop table/chart layouts retained. Focused chart harness verifies synthetic two-pointer pinch, drag continuation, range limits and cleanup. Physical-phone multitouch was not available through IAB.

The compact concept was faithfully checked against the rendered UI with the listed user-directed and data-driven differences. No material clipping or page-level horizontal overflow remained in the tested viewports.

Production release: 3390c810-ac7b-4ed4-83e4-d71991b8aefe, 100% traffic. Both public domains verified, CSS/JS/chart bytes match the isolated release, HTML matches the existing analytics transform. Backend/configuration unchanged. IAB production check at 390 × 844 confirmed the readout above the plot, 10px price axis, expand icon only, active/sold selection, seven builder rows and no horizontal overflow. Evidence: analysis-production.png and builder-production.png. Focused chart, UI and 20 UI concept checks passed, along with the release harness. Temporary viewport override reset after QA.
