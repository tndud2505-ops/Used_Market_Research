// Chrome TWA MessagePort transport. Ordinary web/PWA tabs have no native port.
// No public show-ad URL, SDK, tracking request or persisted completion counter.
const ORIGIN = 'https://used-pick.com';
const APP_ORIGIN = 'android-app://used-pick.com/com.usedpick.app';
let port, nonce, sequence = 0, privacyButton;
const parse = value => {
  try { return typeof value === 'string' ? JSON.parse(value) : value; }
  catch { return null; }
};
function send(type) {
  if (!port || !nonce || document.visibilityState !== 'visible') return;
  try { port.postMessage(JSON.stringify({ type, version: 1, nonce, sequence: ++sequence })); }
  catch { port = undefined; privacyButton?.remove(); }
}
function privacyOptions(required) {
  privacyButton?.remove();
  privacyButton = undefined;
  if (!required) return;
  const parent = document.querySelector('.site-footer nav')
    || document.querySelector('.tools-mobile-policy')
    || document.querySelector('.up-header-links');
  if (!parent) return;
  privacyButton = document.createElement('button');
  privacyButton.type = 'button';
  privacyButton.className = 'pwa-install-link';
  privacyButton.textContent = '광고 개인정보 설정';
  privacyButton.addEventListener('click', () => send('used-pick:privacy-options'));
  parent.append(privacyButton);
}
function receive(event) {
  const data = parse(event.data);
  if (validHello(data)) {
    nonce = data.nonce; sequence = 0;
    send('used-pick:bridge-ready');
  } else if (nonce && data?.version === 1 && data.type === 'used-pick:privacy-required'
      && typeof data.required === 'boolean') privacyOptions(data.required);
}
function validHello(data) {
  return data?.type === 'used-pick:native-ready' && data.version === 1
    && typeof data.nonce === 'string' && /^[a-zA-Z0-9_-]{16,128}$/u.test(data.nonce);
}
if (typeof window !== 'undefined' && window.top === window) {
  window.addEventListener('message', event => {
    const data = parse(event.data);
    if (location.origin !== ORIGIN || (event.origin !== ORIGIN && event.origin !== APP_ORIGIN)
        || (event.source && event.source !== window)
        || (event.data !== '' && !validHello(data))
        || event.ports?.length !== 1) return;
    port?.close();
    port = event.ports[0]; nonce = undefined; sequence = 0;
    port.onmessage = receive;
    port.start();
    // Chrome transfers the port in an empty window message. The authenticated
    // native hello follows on that port; its queued data is delivered on start.
    if (validHello(data)) receive(event);
  });
  window.addEventListener('pagehide', () => {
    port?.close(); port = undefined; privacyOptions(false);
  });
}
export function notifyAnalysisComplete() {
  send('used-pick:analysis-complete');
}
