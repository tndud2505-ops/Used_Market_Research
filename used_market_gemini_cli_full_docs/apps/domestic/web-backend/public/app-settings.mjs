// Set a verified, publicly available listing URL after Play publication.
// null keeps the Play download link hidden; a web PWA can still be installed.
export const APP_SETTINGS = Object.freeze({
  playStoreUrl: null,
  paidAds: Object.freeze({ web: true, installed: false }),
});

// Presentation hints only. Never use this for auth, API access or price data.
export function appSurface(browser = globalThis.window, page = globalThis.document) {
  if (browser?.matchMedia?.('(display-mode: standalone)').matches
      || browser?.matchMedia?.('(display-mode: fullscreen)').matches
      || browser?.navigator?.standalone === true
      || /^android-app:\/\/com\.usedpick\.app(?:\/|$)/u.test(page?.referrer || '')) {
    return 'installed';
  }
  return 'web';
}

export function paidWebAdsAllowed() {
  return APP_SETTINGS.paidAds[appSurface()] === true;
}

export function verifiedPlayStoreUrl(value = APP_SETTINGS.playStoreUrl) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://play.google.com' || url.pathname !== '/store/apps/details'
        || url.searchParams.get('id') !== 'com.usedpick.app' || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
