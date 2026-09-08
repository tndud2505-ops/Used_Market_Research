import { shiftDate } from './pc-tools-core.mjs?v=8';

// A small, keyboard-accessible calendar; the input also accepts a typed date.
export function createDatePicker(root) {
  const make = (tag, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
  const wrap = make('div'); wrap.className = 'tools-date-picker';
  const input = make('input'); input.type = 'date'; input.id = 'chart-date'; input.setAttribute('aria-label', '가격 조회 날짜');
  const toggle = make('button'); toggle.type = 'button'; toggle.setAttribute('aria-label', '달력 열기'); toggle.setAttribute('aria-haspopup', 'dialog'); toggle.setAttribute('aria-expanded', 'false');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 20 20'); icon.setAttribute('width', '18'); icon.setAttribute('height', '18'); icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(icon.namespaceURI, 'path');
  path.setAttribute('d', 'M4 4h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM3 8h14M7 2v4M13 2v4');
  path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.5'); icon.append(path); toggle.append(icon);
  const popup = make('div'); popup.className = 'tools-calendar'; popup.id = 'chart-calendar'; popup.hidden = true; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '가격 조회 달력'); toggle.setAttribute('aria-controls', popup.id);
  wrap.append(input, toggle, popup); root.append(wrap);
  let month = '';
  const close = () => { popup.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  const dayButton = date => [...popup.querySelectorAll('[data-date]')].find(button => button.dataset.date === date);
  function render() {
    popup.replaceChildren();
    const header = make('div'); header.className = 'calendar-heading';
    const [year, number] = month.split('-').map(Number);
    const title = make('strong', `${year}년 ${number}월`); title.setAttribute('aria-live', 'polite');
    for (const [offset, label, glyph] of [[-1, '이전 달', '‹'], [1, '다음 달', '›']]) {
      const button = make('button', glyph); button.type = 'button'; button.dataset.month = offset; button.setAttribute('aria-label', label);
      const next = shiftDate(month, offset, 'month'); button.disabled = next.slice(0, 7) < input.min.slice(0, 7) || next.slice(0, 7) > input.max.slice(0, 7);
      header.append(button);
    }
    header.prepend(title); popup.append(header);
    const grid = make('div'); grid.className = 'calendar-days';
    ['일', '월', '화', '수', '목', '금', '토'].forEach(day => grid.append(make('span', day)));
    const offset = new Date(`${month}T00:00:00Z`).getUTCDay();
    const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    for (let i = 0; i < offset; i++) { const blank = make('span'); blank.setAttribute('aria-hidden', 'true'); grid.append(blank); }
    for (let day = 1; day <= count; day++) {
      const date = `${month.slice(0, 8)}${String(day).padStart(2, '0')}`;
      const button = make('button', String(day)); button.type = 'button'; button.dataset.date = date;
      button.disabled = date < input.min || date > input.max; button.setAttribute('aria-label', `${year}년 ${number}월 ${day}일`);
      button.setAttribute('aria-pressed', String(date === input.value)); grid.append(button);
    }
    popup.append(grid);
  }
  toggle.addEventListener('click', () => {
    if (!popup.hidden) { close(); return; }
    month = `${(input.value || input.max).slice(0, 7)}-01`; render(); popup.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    (dayButton(input.value) || popup.querySelector('[data-date]:not(:disabled)'))?.focus();
  });
  popup.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.month) {
      const direction = button.dataset.month; month = shiftDate(month, Number(direction), 'month'); render();
      popup.querySelector(`[data-month="${direction}"]`)?.focus();
    } else if (button.dataset.date) {
      input.value = button.dataset.date; close(); input.dispatchEvent(new Event('change', { bubbles: true })); input.focus();
    }
  });
  wrap.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !popup.hidden) { event.preventDefault(); close(); toggle.focus(); return; }
    const date = event.target.dataset?.date, amount = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!date || !amount) return;
    event.preventDefault(); const next = shiftDate(date, amount);
    if (next < input.min || next > input.max) return;
    if (next.slice(0, 7) !== month.slice(0, 7)) { month = `${next.slice(0, 7)}-01`; render(); }
    dayButton(next)?.focus();
  });
  document.addEventListener('click', event => { if (!event.composedPath().includes(wrap)) close(); });
  document.addEventListener('focusin', event => { if (!wrap.contains(event.target)) close(); });
  return input;
}
