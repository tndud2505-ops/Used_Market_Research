import { appSurface, verifiedPlayStoreUrl } from './app-settings.mjs';
import './app-ad-bridge.mjs?v=1';

let installPrompt;
let installArea;
const displayMode = window.matchMedia('(display-mode: standalone)');

function syncInstallLink() {
  installArea?.remove();
  installArea = undefined;
  document.documentElement.dataset.appSurface = appSurface();
  if (appSurface() !== 'web') return;
  const storeUrl = verifiedPlayStoreUrl();
  if (!storeUrl && !installPrompt) return;
  const parent = document.querySelector('.site-footer nav, .page-links, .up-header-links');
  if (!parent) return;
  if (storeUrl) {
    installArea = document.createElement('a');
    installArea.href = storeUrl;
    installArea.textContent = 'Google Play에서 앱 다운로드';
    installArea.rel = 'noopener noreferrer';
  } else {
    installArea = document.createElement('button');
    installArea.type = 'button';
    installArea.textContent = '앱 설치';
    installArea.addEventListener('click', async () => {
      const prompt = installPrompt;
      if (!prompt) return;
      installPrompt = undefined;
      syncInstallLink();
      try { await prompt.prompt(); await prompt.userChoice; }
      catch { /* Browser owns prompt eligibility; retry when it offers again. */ }
    });
  }
  installArea.className = 'pwa-install-link';
  parent.append(installArea);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  syncInstallLink();
});
window.addEventListener('appinstalled', () => {
  installPrompt = undefined;
  installArea?.remove();
});
displayMode.addEventListener('change', syncInstallLink);
syncInstallLink();

if ('serviceWorker' in navigator) {
  const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch((error) => console.warn('앱 설치 준비를 완료하지 못했습니다.', error.message));
  if (document.readyState === 'complete') void register();
  else window.addEventListener('load', register, { once: true });
}
