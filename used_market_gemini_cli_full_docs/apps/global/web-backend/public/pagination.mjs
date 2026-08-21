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
