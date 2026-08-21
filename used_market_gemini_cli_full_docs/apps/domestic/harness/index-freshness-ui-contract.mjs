import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../web-backend/public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web-backend/public/app.js", import.meta.url), "utf8");

assert.match(html, /id="freshness-status"/u);
assert.match(html, /id="apply-refresh-results"/u);
assert.match(app, /const REFRESH_POLL_MAX_MS = 180_000;/u);
assert.match(app, /function refreshPollDelay\(serverDelayMs, attempt\)/u);
assert.match(app, /payload\.data\?\.refresh\?\.poll_after_ms/u);
assert.match(app, /const elapsed = Date\.now\(\) - state\.refreshPollStartedAt;[\s\S]{0,100}if \(elapsed >= REFRESH_POLL_MAX_MS\)/u);
assert.match(app, /\/api\/search\/refresh\/\$\{encodeURIComponent\(token\)\}/u);
assert.match(app, /fingerprint !== state\.refreshFingerprint/u);
assert.match(app, /state\.currentPage === 0/u);
assert.match(app, /refreshIndex: MARKET_PROFILE === 'global'[\s\S]*?\? false[\s\S]*?: !\['price_filter', 'sort', 'pagination', 'site_filter'\]\.includes\(reason\)/u);
assert.match(app, /새 매물 \$\{added\}개/u);
assert.match(app, /pendingResultKind === 'stale'/u);
assert.match(app, /오래된 결과 보기/u);

console.log(JSON.stringify({ status: "passed", checks: 13 }, null, 2));
