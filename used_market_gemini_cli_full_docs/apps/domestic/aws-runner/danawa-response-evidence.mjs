import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { danawaPublicCardEvidence } from '../collector/logic/danawa-search.mjs';

// This is an inert structural outline, not a saved page. Never retain scripts,
// URLs, form values, arbitrary attributes, query text, cookies or page text.
export function danawaResponseOutline(html) {
  const input = String(html);
  const markup = input.slice(0, 4 * 1024 * 1024).replace(/<!--[^]*?(?:-->|$)/gu, '')
    .replace(/<(script|style|template|noscript|textarea)\b[^>]*>[^]*?(?:<\/\1\s*>|$)/giu, '');
  const signatures = new Map();
  let prefix = '', tail = '', length = 0;
  const append = value => {
    const line = `${value}\n`;
    length += line.length;
    const take = Math.min(line.length, 98304 - prefix.length);
    prefix += line.slice(0, take);
    tail = (tail + line.slice(take)).slice(-32768);
  };
  for (const match of markup.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/giu)) {
    if (match[1]) {
      const tag = match[1].toLowerCase();
      if (match[0].startsWith('</')) { append(`</${tag}>`); continue; }
      const classes = /\bclass\s*=\s*["']([^"']*)["']/iu.exec(match[0])?.[1] || '';
      // Reject opaque IDs/tokens instead of retaining arbitrary attribute data.
      const safeClasses = classes.split(/\s+/u).filter(value => /^[a-z][a-z_-]{1,48}$/iu.test(value)).slice(0, 8);
      const signature = `${tag}${safeClasses.map(value => `.${value}`).join('')}`;
      if (signatures.has(signature) || signatures.size < 512) signatures.set(signature, (signatures.get(signature) || 0) + 1);
      append(`<${tag}${safeClasses.length ? ` class="${safeClasses.join(' ')}"` : ''}>`);
    } else {
      const value = match[2].replace(/\s+/gu, ' ').trim();
      if (!value) continue;
      const markers = ['검색결과', '검색 결과', '상품이 없습니다', '검색된 상품이 없습니다', '검색 결과가 없습니다',
        '일치하는 상품', '자동입력', '접근이 제한', 'Access Denied', 'captcha'].filter(marker => value.toLowerCase().includes(marker.toLowerCase()));
      append(markers.length ? `[markers:${markers.join('|')}]` : `[text:${value.length}]`);
    }
  }
  return { signatures: Object.fromEntries(signatures), truncated: length > 131072 || input.length > 4 * 1024 * 1024,
    outline: `${prefix}${length > 131072 ? '\n[truncated]\n' : ''}${tail}` };
}

export function saveDanawaResponseEvidence(indexPath, { html, diagnostic }, now = new Date()) {
  const root = path.join(path.dirname(indexPath), 'danawa-response-evidence');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // Six fixed slots, shared across scheduler/operator paths. No accumulating
  // raw responses or backups; one slot per hour is enough for shape diagnosis.
  const slot = Math.floor(now.getTime() / 3600000) % 6;
  const filename = path.join(root, `response-${slot}.json`);
  const temporary = `${filename}.tmp`;
  const cardDiagnostics = [];
  const evidence = { captured_at: now.toISOString(), status: diagnostic.status,
    body_sha256: diagnostic.body_sha256, bytes: diagnostic.bytes, ...danawaResponseOutline(html),
    public_product_cards: danawaPublicCardEvidence(html, cardDiagnostics),
    public_product_card_diagnostics: cardDiagnostics };
  writeFileSync(temporary, JSON.stringify(evidence), { mode: 0o600 });
  renameSync(temporary, filename);
}
