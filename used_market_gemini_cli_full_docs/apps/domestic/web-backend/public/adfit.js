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
  let collapseTimer;
  const hasCreative = () => Boolean(root.querySelector("iframe, .kakao_ad_area > *"));
  const sync = () => {
    if (!eligible) root.hidden = true;
    else if (hasCreative()) root.hidden = false;
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  root.hidden = true;

  return {
    setEligible(value) {
      eligible = Boolean(value);
      clearTimeout(collapseTimer);
      if (!eligible) {
        root.hidden = true;
        return;
      }
      root.hidden = false;
      void loadSdk().catch(() => { root.hidden = true; });
      collapseTimer = setTimeout(() => {
        if (eligible && !hasCreative()) root.hidden = true;
      }, 5_000);
    },
  };
}
