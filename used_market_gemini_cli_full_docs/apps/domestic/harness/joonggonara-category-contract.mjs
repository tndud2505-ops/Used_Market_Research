import assert from 'node:assert/strict';
import { getSourceCategoryBinding, listCategoryNodes } from '../dist/market/logic/category-catalog.js';

const baseUrl = 'https://web.joongna.com/search?category=';
const ids = [...new Set(
  listCategoryNodes()
    .flatMap((category) => getSourceCategoryBinding('joonggonara', category.id)?.sourceCategoryIds ?? [])
    .map(String)
)];
const results = [];
let nextIndex = 0;

async function checkNext() {
  while (nextIndex < ids.length) {
    const id = ids[nextIndex++];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`${baseUrl}${encodeURIComponent(id)}`, {
        signal: controller.signal,
        redirect: 'manual'
      });
      results.push({ id, status: response.status });
      await response.body?.cancel();
    } catch (error) {
      results.push({ id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      clearTimeout(timer);
    }
  }
}

await Promise.all(Array.from({ length: 6 }, () => checkNext()));
results.sort((left, right) => left.id.localeCompare(right.id));
const failed = results.filter((result) => result.status !== 200 || result.error);
assert.equal(failed.length, 0, `Joonggonara category URLs failed: ${JSON.stringify(failed)}`);

console.log(JSON.stringify({
  status: 'passed',
  endpoint: baseUrl,
  checked_category_ids: results.length,
  status_counts: Object.fromEntries(
    [...new Set(results.map((result) => result.status))]
      .map((status) => [status, results.filter((result) => result.status === status).length])
  )
}, null, 2));
