const SDK_URL = "https://t1.kakaocdn.net/kas/static/ba.min.js";
let sdkPromise;

function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SDK_URL}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.dataset.usedPickAdfit = "true";
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.body.append(script);
  });
  return sdkPromise;
}

export function createAdfitSlot(root) {
  if (!root) return { setEligible() {} };

  let eligible = false;
  let started = false;
  let failed = false;
  let collapseTimer;
  const desktop = window.matchMedia('(min-width: 1360px)');
  const format = desktop.matches ? 'desktop' : 'mobile';
  const template = root.querySelector(`template[data-format="${format}"]`);
  if (template) root.append(template.content.cloneNode(true));
  root.dataset.format = format;
  const fits = () => format !== 'desktop' || desktop.matches;
  const hasCreative = () => Boolean(root.querySelector("iframe, .kakao_ad_area > *"));
  const sync = () => {
    if (!eligible || failed || !fits()) root.hidden = true;
    else if (hasCreative()) root.hidden = false;
  };
  window.usedPickAdfitNoAd = () => { failed = true; root.hidden = true; };
  root.querySelector('ins')?.setAttribute('data-ad-onfail', 'usedPickAdfitNoAd');
  desktop.addEventListener('change', sync);
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  root.hidden = true;

  return {
    setEligible(value) {
      eligible = Boolean(value);
      if (!eligible || failed || !fits()) {
        root.hidden = true;
        return;
      }
      if (started) { sync(); return; }
      started = true;
      root.hidden = false;
      void loadSdk().catch(() => { failed = true; root.hidden = true; });
      collapseTimer = setTimeout(() => {
        if (eligible && !hasCreative()) root.hidden = true;
      }, 5_000);
    },
  };
}
