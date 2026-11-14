export function priceWindowUrl(modelId, { source = '', manufacturer = '', kind = 'active' } = {}) {
  const url = new URL('/price-analysis.html', location.href);
  url.searchParams.set('window', '1');
  if (modelId) url.searchParams.set('model', modelId);
  if (source) url.searchParams.set('sites', source);
  if (source === 'ebay') url.searchParams.set('currency', 'USD');
  if (manufacturer) url.searchParams.set('manufacturer', manufacturer);
  if (kind === 'sold') url.searchParams.set('kind', 'sold');
  return url.pathname + url.search;
}

// Ordinary modifier clicks and popup-blocked browsers retain the native new-tab link.
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[data-price-window]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname !== '/price-analysis.html') return;
  url.searchParams.set('window', '1');
  const width = Math.min(1180, screen.availWidth || 1180), height = Math.min(850, screen.availHeight || 850);
  const popup = window.open(url.href, 'used-pick-price-chart', `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`);
  if (popup) { popup.opener = null; popup.focus(); event.preventDefault(); }
});
