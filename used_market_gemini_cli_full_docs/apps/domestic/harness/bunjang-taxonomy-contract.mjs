import assert from 'node:assert/strict';
import { getSourceCategoryBinding, listCategoryNodes } from '../dist/market/logic/category-catalog.js';

const endpoint = 'https://api.bunjang.co.kr/api/mdms/v1/categories';
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 20_000);

function flattenCategories(node, output = []) {
  if (!node || typeof node !== 'object') return output;
  if (node.id !== undefined && node.id !== null) {
    output.push({
      id: String(node.id),
      name: typeof node.name === 'string' ? node.name : typeof node.displayName === 'string' ? node.displayName : '',
      enabled: node.isEnable !== false
    });
  }

  for (const key of ['categories', 'children', 'childCategories', 'subCategories']) {
    if (Array.isArray(node[key])) {
      for (const child of node[key]) flattenCategories(child, output);
    }
  }
  return output;
}

try {
  const response = await fetch(endpoint, { signal: controller.signal });
  assert.equal(response.ok, true, `Bunjang taxonomy request failed: HTTP ${response.status}`);
  const body = await response.json();
  const roots = Array.isArray(body?.data) ? body.data : [];
  assert.ok(roots.length > 0, 'Bunjang taxonomy response has no root categories');

  const sourceIds = new Map();
  for (const category of listCategoryNodes()) {
    const binding = getSourceCategoryBinding('bunjang', category.id);
    for (const sourceCategoryId of binding?.sourceCategoryIds ?? []) {
      sourceIds.set(String(sourceCategoryId), category.id);
    }
  }

  const liveCategories = roots.flatMap((root) => flattenCategories(root));
  const liveById = new Map(liveCategories.map((category) => [category.id, category]));
  const missing = [...sourceIds.keys()].filter((id) => !liveById.has(id));
  const disabled = [...sourceIds.keys()].filter((id) => liveById.has(id) && !liveById.get(id).enabled);

  assert.deepEqual(missing, [], `Bunjang category IDs missing from official taxonomy: ${missing.join(', ')}`);
  assert.deepEqual(disabled, [], `Bunjang category IDs disabled in official taxonomy: ${disabled.join(', ')}`);

  console.log(JSON.stringify({
    status: 'passed',
    endpoint,
    root_count: roots.length,
    live_category_count: liveCategories.length,
    verified_binding_count: sourceIds.size,
    missing,
    disabled
  }, null, 2));
} finally {
  clearTimeout(timeout);
}
