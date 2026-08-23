export const RESULT_PAGE_SIZE = 30;
export const RESULT_WINDOW_MAX = 1000;

export function resultPageCount(availableCount, pageSize = RESULT_PAGE_SIZE) {
  const normalizedCount = Number.isFinite(Number(availableCount))
    ? Math.min(Math.max(0, Math.floor(Number(availableCount))), RESULT_WINDOW_MAX)
    : 0;
  const normalizedPageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0
    ? Math.floor(Number(pageSize))
    : RESULT_PAGE_SIZE;
  return normalizedCount > 0 ? Math.ceil(normalizedCount / normalizedPageSize) : 0;
}

export function clampResultPage(pageIndex, pageCount) {
  const normalizedCount = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (normalizedCount === 0) return 0;
  return Math.min(Math.max(0, Math.floor(Number(pageIndex) || 0)), normalizedCount - 1);
}

export function paginationItems(pageIndex, pageCount) {
  const normalizedCount = Math.max(0, Math.floor(Number(pageCount) || 0));
  if (normalizedCount <= 7) return Array.from({ length: normalizedCount }, (_, index) => index);
  const current = clampResultPage(pageIndex, normalizedCount);
  const visiblePages = [...new Set([0, current - 1, current, current + 1, normalizedCount - 1])]
    .filter((index) => index >= 0 && index < normalizedCount)
    .sort((left, right) => left - right);
  const items = [];
  for (const page of visiblePages) {
    if (items.length && page - items.at(-1) > 1) items.push('ellipsis');
    items.push(page);
  }
  return items;
}

export function paginationControlItems({ currentPage = 0, loadedPageCount, canLoadNext = false } = {}) {
  const loaded = Math.max(0, Math.floor(Number(loadedPageCount) || 0));
  const reachable = loaded + (canLoadNext ? 1 : 0);
  const current = clampResultPage(currentPage, Math.max(loaded, 1));
  const pages = reachable <= 7
    ? Array.from({ length: reachable }, (_, page) => page)
    : [...new Set([0, current - 1, current, current + 1, loaded - 1, ...(canLoadNext ? [loaded] : [])])]
      .filter((page) => page >= 0 && page < reachable)
      .sort((left, right) => left - right);
  const items = [];
  for (const page of pages) {
    if (items.length && page - items.at(-1).page > 1) items.push({ type: 'ellipsis' });
    items.push({ type: 'page', page, state: page < loaded ? 'loaded' : 'next' });
  }
  if (canLoadNext) items.push({ type: 'continuation', state: 'locked' });
  return items;
}
