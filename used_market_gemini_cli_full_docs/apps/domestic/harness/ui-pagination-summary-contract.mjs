import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../web-backend/public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web-backend/public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../web-backend/public/pagination-toolbar.css", import.meta.url), "utf8");

assert.doesNotMatch(app, /switchLabel:\s*['"]해외 시안['"]/u);
assert.doesNotMatch(app, /switchUrl:\s*['"]\/global\/['"]/u);
assert.match(html, /id="result-summary-pagination"/u);
assert.match(html, /pagination-toolbar\.css\?v=summary-pagination-v1/u);
assert.match(html, /app\.js\?v=search-session-v8/u);
assert.match(styles, /\.result-summary-pagination/u);
assert.match(app, /function renderPaginationControls/u);
assert.match(app, /\['#pagination-controls', '#result-summary-pagination'\]/u);
assert.match(app, /async function prefetchActiveResultPages/u);
assert.match(app, /SITE_PREFETCH_PAGES \* RESULT_PAGE_SIZE/u);
assert.match(app, /reason === 'search'[\s\S]{0,220}prefetchActiveResultPages/u);
assert.match(app, /refreshIndex:\s*false/u);

console.log(JSON.stringify({ status: "passed", checks: 12 }, null, 2));
