import { createHousePromotion } from './train-gallery/motion.js?v=1';
import { androidAppShell } from '../app-settings.mjs';

// First-party promotions only: no ad network SDK, cookie, impression or click request.
// USED PICK itself is not promoted on its own site. Creative source:
// Career_Management promotion-assets/2026-11-14 (2x JPEG, same family as the
// original Train Gallery banner).
export const HOUSE_PRODUCTS = Object.freeze([
  { id: 'train-gallery', name: '트레인갤러리', message: '운동을 기록하고 영상으로 남겨요.',
    appUrl: 'https://play.google.com/store/apps/details?id=com.trainingapp.traingallery', webUrl: null },
  { id: 'woori-journey', name: '우리여정', message: '사진과 글로 우리의 하루를 남겨요.',
    appUrl: 'https://play.google.com/store/apps/details?id=app.dulharu.couple',
    webUrl: 'https://dulharu-dev.tndud2503.workers.dev/about?lang=ko-KR' },
  { id: 'k-stock', name: 'K Stock', message: '국내 종목과 차트를 한곳에서 살펴봐요.',
    appUrl: null, webUrl: 'https://kstockclock.com/' },
  { id: 'jira-obsidian', name: 'Jira Obsidian', message: '이슈의 계층과 연결을 한눈에 살펴봐요.',
    appUrl: null, webUrl: 'https://marketplace.atlassian.com/apps/1923219004/obsidian-context-map-for-jira' },
]);

const ROTATE_MS = 10_000;
const TICK_MS = 1_000;
const FADE_MS = 250;
// Both slots share one index; the bottom stays two products ahead of the rail,
// so one screen never shows the same product twice.
const SLOT_OFFSET = { rail: 0, bottom: 2 };

export function productFor(placement, index, products = HOUSE_PRODUCTS) {
  const count = products.length;
  return products[(((index + (SLOT_OFFSET[placement] ?? 0)) % count) + count) % count];
}

// App products always open their official Play listing, including on desktop.
// USED PICK itself is excluded from this site's catalog.
export function destinationFor(product) {
  const url = product.appUrl || product.webUrl;
  const host = new URL(url).hostname;
  const label = host === 'play.google.com' ? 'Google Play에서 보기'
    : host === 'marketplace.atlassian.com' ? 'Atlassian Marketplace에서 보기' : '웹사이트에서 보기';
  return { url, label };
}

const element = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

function buildSlot(root) {
  const placement = root.dataset.placement === 'rail' ? 'rail' : 'bottom';
  const motionRoot = placement === 'bottom' ? root.querySelector('[data-house-motion="train-gallery"]') : null;
  const motion = motionRoot ? createHousePromotion(motionRoot) : null;
  const stage = element('div', 'house-promo__stage');
  const link = element('a', 'house-promo__link');
  link.target = '_blank';
  link.rel = 'sponsored noopener noreferrer';
  const image = element('img');
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'lazy';
  let source = null;
  if (placement === 'rail') {
    image.width = 160; image.height = 600;
    link.append(image);
  } else {
    const picture = element('picture');
    source = element('source');
    source.media = '(max-width: 860px)';
    source.width = 320; source.height = 100;
    image.width = 960; image.height = 140;
    picture.append(source, image);
    link.append(picture);
  }
  stage.append(link);
  if (motionRoot) stage.append(motionRoot);
  const caption = element('div', 'house-promo__caption');
  const label = element('span');
  label.textContent = '광고';
  const pause = element('button', 'house-promo__pause');
  pause.type = 'button';
  pause.hidden = true;
  caption.append(label, pause);
  root.replaceChildren(stage, caption);
  return { root, placement, stage, link, image, source, motion, pause, product: null };
}

export function createPromotionSlots(roots) {
  const slots = [...roots].filter(Boolean);
  if (androidAppShell()) {
    // The installed Android app carries its own single AdMob placement instead.
    for (const root of slots) root.hidden = true;
    return { setEligible() {} };
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = window.matchMedia('(min-width: 861px)');
  const views = slots.map(buildSlot);
  const visible = new Set();
  const hovered = new Set();
  const focused = new Set();
  let index = Math.floor(Math.random() * HOUSE_PRODUCTS.length);
  let eligible = false;
  let started = false;
  let userPaused = false;
  let activeMs = 0;

  const syncMotion = view => {
    const useMotion = Boolean(view.motion) && view.product?.id === 'train-gallery' && desktop.matches;
    view.link.hidden = useMotion;
    view.motion?.setEligible(eligible && useMotion);
  };
  const render = view => {
    const product = productFor(view.placement, index);
    const { url, label } = destinationFor(product);
    const art = format => `/promotions/house/${product.id}-${format}.jpg?v=20261115-play`;
    view.link.href = url;
    view.link.setAttribute('aria-label', `${product.name} — ${product.message} ${label} (새 창)`);
    if (view.source) view.source.srcset = art('strip');
    view.image.src = art(view.placement === 'rail' ? 'rail' : 'wide');
    view.product = product;
    syncMotion(view);
  };
  const syncPauseButtons = () => {
    for (const view of views) {
      view.pause.hidden = reducedMotion.matches;
      view.pause.textContent = userPaused ? '넘기기' : '멈춤';
      view.pause.setAttribute('aria-label', userPaused ? '광고 자동 넘김 다시 시작' : '광고 자동 넘김 멈춤');
      view.pause.setAttribute('aria-pressed', String(userPaused));
    }
  };
  const rotate = () => {
    index += 1;
    for (const view of views) {
      if (!view.root.getClientRects().length) { render(view); continue; }
      view.stage.classList.add('is-changing');
      setTimeout(() => {
        render(view);
        const reveal = () => view.stage.classList.remove('is-changing');
        const decoded = view.link.hidden ? Promise.resolve() : view.image.decode?.();
        Promise.race([decoded || Promise.resolve(), new Promise(resolve => setTimeout(resolve, 1_500))])
          .catch(() => {}).finally(reveal);
      }, FADE_MS);
    }
  };
  const start = () => {
    started = true;
    for (const view of views) render(view);
    syncPauseButtons();
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) visible.add(entry.target);
        else visible.delete(entry.target);
      }
    }, { threshold: [0, 0.5] });
    for (const view of views) {
      observer?.observe(view.root);
      view.root.addEventListener('pointerenter', () => hovered.add(view.root));
      view.root.addEventListener('pointerleave', () => hovered.delete(view.root));
      view.root.addEventListener('focusin', () => focused.add(view.root));
      view.root.addEventListener('focusout', event => {
        if (!view.root.contains(event.relatedTarget)) focused.delete(view.root);
      });
      view.pause.addEventListener('click', () => { userPaused = !userPaused; syncPauseButtons(); });
    }
    reducedMotion.addEventListener?.('change', syncPauseButtons);
    desktop.addEventListener?.('change', () => views.forEach(syncMotion));
    // Advance only while a promotion is actually on screen and nobody is reading,
    // hovering, focusing or has paused it. Reduced motion keeps one product.
    setInterval(() => {
      if (!eligible || userPaused || reducedMotion.matches || document.hidden || hovered.size || focused.size || !visible.size) return;
      activeMs += TICK_MS;
      if (activeMs < ROTATE_MS) return;
      activeMs = 0;
      rotate();
    }, TICK_MS);
  };

  for (const root of slots) root.hidden = true;
  return {
    setEligible(value) {
      eligible = Boolean(value);
      for (const view of views) view.root.hidden = !eligible;
      if (eligible && !started) start();
      else views.forEach(syncMotion);
    },
  };
}
