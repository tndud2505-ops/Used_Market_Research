import { SERIES, idOf, nameOf, sourceStats, dailySeries, priceRecordIssue } from './pc-tools-core.mjs?v=parts-ux-v5';
import { createPriceStore } from './pc-tools-data.mjs?v=parts-data-v5';
import { drawChart } from './pc-tools-chart.mjs?v=search-modal-v3';

// The preview uses the same validated statistics and gap handling as analysis.
// It never navigates, changes listing state, or fetches prices before opening.
export function createListingPricePreview(dialog, opener) {
  const find = id => dialog.querySelector(`#listing-price-${id}`);
  const chart = find('chart'), status = find('status'), retry = find('retry');
  const labels = { '': '국내 전체', joonggonara: '중고나라', bunjang: '번개장터', ebay: 'eBay' };
  let selection = null, frame = 0, lastWidth = 0;
  const schedule = () => {
    if (!dialog.open || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  };
  const domestic = createPriceStore(schedule);
  const overseas = createPriceStore(schedule, { marketPool: 'OVERSEAS_USED', currency: 'USD' });
  const store = () => selection?.source === 'ebay' ? overseas : domestic;
  const clearChart = () => {
    // drawChart releases its document-level pointer listener on replacement.
    drawChart(chart, []);
    chart.replaceChildren();
  };
  function render() {
    if (!dialog.open || !selection) return;
    const { product, source } = selection, currency = source === 'ebay' ? 'USD' : 'KRW';
    const record = store().get(idOf(product), 30);
    const loading = !record || record.state === 'loading';
    const data = record?.state === 'ready' ? sourceStats(record.data, source) : null;
    const issue = priceRecordIssue(record, data);
    const series = SERIES.slice(0, 2).map(({ key }) => ({ key, points: dailySeries(issue ? null : data, key, 30) }));
    const hasPoints = series.some(s => s.points.some(p => p.value != null));
    chart.dataset.modelId = idOf(product);
    chart.dataset.source = source;
    chart.dataset.priceState = loading ? 'loading' : record.state === 'error' ? 'error' : issue ? 'unavailable' : hasPoints ? 'ready' : 'empty';
    chart.setAttribute('aria-busy', String(loading));
    const window = record?.data?.published_window || record?.data?.window;
    find('scope').textContent = `${labels[source] || source} · ${currency} · ${window?.from && window?.to ? `${window.from} ~ ${window.to}` : '최근 30일'}`;
    status.textContent = issue || (hasPoints ? '' : '이 기간에 표시할 일별 대표가격 자료가 없습니다.');
    status.hidden = !status.textContent;
    retry.hidden = record?.state !== 'error';
    chart.hidden = !hasPoints;
    if (hasPoints) drawChart(chart, series, { label: `${nameOf(product)} ${labels[source] || source} 가격 추이`, currency, compact: true });
    else clearChart();
  }
  retry.addEventListener('click', () => { if (selection) void store().load([selection.product], 30); });
  find('close').addEventListener('click', () => dialog.close());
  // Require both pointer-down and click outside, so dragging from the chart
  // to the backdrop does not accidentally dismiss the preview.
  let backdropPress = false;
  const outside = event => {
    const rect = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  };
  dialog.addEventListener('pointerdown', event => { backdropPress = outside(event); });
  dialog.addEventListener('click', event => {
    if (backdropPress && outside(event)) dialog.close();
    backdropPress = false;
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    selection = null;
    domestic.clear(); overseas.clear();
    cancelAnimationFrame(frame); frame = 0;
    clearChart(); chart.setAttribute('aria-busy', 'false');
    document.body.classList.remove('has-price-preview');
    if (opener.isConnected && !opener.hidden) opener.focus({ preventScroll: true });
  });
  const observer = new ResizeObserver(entries => {
    const width = Math.round(entries[0].contentRect.width);
    if (width !== lastWidth) { lastWidth = width; schedule(); }
  });
  observer.observe(dialog);
  return {
    open(product, source = '') {
      if (!idOf(product) || dialog.open) return;
      selection = { product, source };
      find('model').textContent = nameOf(product);
      dialog.showModal();
      document.body.classList.add('has-price-preview');
      render();
      void store().load([product], 30);
    },
  };
}
