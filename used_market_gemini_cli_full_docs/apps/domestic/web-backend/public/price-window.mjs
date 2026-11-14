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

// Keep the listing and its scroll position alive while inspecting a price.
// A plain href still supports sharing, modifier clicks and browsers without dialog.
let surface, frame, opener;
const marker = 'usedPickPriceSurface';
function closeSurface() {
  if (!surface?.open) return;
  surface.close();
  frame.remove(); frame = null;
  document.body.classList.remove('has-price-surface');
  opener?.focus({ preventScroll: true });
}
function dismissSurface() {
  if (history.state?.[marker]) history.back(); else closeSurface();
}
function openSurface(url, link) {
  if (!surface) {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/price-surface.css?v=mobile-chart-v1'; document.head.append(css);
    surface = document.createElement('dialog'); surface.className = 'price-surface';
    surface.setAttribute('aria-label', '시세');
    const close = document.createElement('button'); close.className = 'price-surface-close';
    close.type = 'button'; close.textContent = '닫기'; close.setAttribute('aria-label', '시세 닫고 매물로 돌아가기');
    close.addEventListener('click', dismissSurface);
    surface.append(close); document.body.append(surface);
    surface.addEventListener('cancel', event => { event.preventDefault(); dismissSurface(); });
    surface.addEventListener('click', event => { if (event.target === surface) dismissSurface(); });
    window.addEventListener('popstate', () => {
      if (!history.state?.[marker]) closeSurface();
      else if (!surface.open) { const state={...history.state}; delete state[marker]; history.replaceState(state,'',location.href); }
    });
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.source === frame?.contentWindow && event.data?.type === 'used-pick:close-price') dismissSurface();
    });
  }
  opener = link; url.searchParams.set('embedded', '1');
  frame?.remove(); frame = document.createElement('iframe'); frame.title = '모델별 시세'; frame.src = url.href; surface.append(frame);
  if (!surface.open) {
    history.pushState({ ...history.state, [marker]: true }, '', location.href);
    document.body.classList.add('has-price-surface'); surface.showModal();
  }
}
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[data-price-window]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname !== '/price-analysis.html') return;
  url.searchParams.set('window', '1');
  if (window.parent !== window) { event.preventDefault(); location.replace(url.href); return; }
  if (typeof HTMLDialogElement === 'undefined') return;
  event.preventDefault(); openSurface(url, link);
});
