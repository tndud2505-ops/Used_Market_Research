// Set a verified, publicly available listing URL after Play publication.
// null keeps the Play download link hidden; a web PWA can still be installed.
export const APP_SETTINGS = Object.freeze({
  playStoreUrl: null,
});

const ANDROID_APP_REFERRER = /^android-app:\/\/com\.usedpick\.app(?:\/|$)/u;
const ANDROID_APP_SESSION_KEY = 'usedPickAndroidApp';

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

// True only inside the installed USED PICK Android app (TWA). Chrome provides the
// app referrer on launch; keep it for later pages in the same app tab. Website
// house promotions are hidden there because the app has its own AdMob placement.
export function androidAppShell(page = globalThis.document, storage = globalThis.sessionStorage) {
  const launchedByApp = ANDROID_APP_REFERRER.test(page?.referrer || '');
  try {
    if (launchedByApp) storage?.setItem(ANDROID_APP_SESSION_KEY, '1');
    return launchedByApp || storage?.getItem(ANDROID_APP_SESSION_KEY) === '1';
  } catch {
    return launchedByApp;
  }
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
