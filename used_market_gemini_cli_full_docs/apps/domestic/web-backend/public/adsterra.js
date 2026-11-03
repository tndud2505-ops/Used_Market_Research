const AD_OPTIONS = {
  key: "620bb9616d802ecfa4b7e1485fd916a1",
  format: "iframe",
  height: 600,
  width: 160,
  params: {}
};
const AD_SCRIPT_URL = "https://bauval.org/22/620bb9616d802ecfa4b7e1485fd916a1";

export function createAdsterraSlot(root) {
  if (!root) return { setEligible() {} };

  const adSlot = root.querySelector("[data-adsterra-slot]");
  if (!adSlot) return { setEligible() {} };

  const desktopMedia = window.matchMedia("(min-width: 1360px)");
  let hasResults = false;
  let eligible = false;
  let tagLoaded = false;

  function loadTag() {
    if (tagLoaded) return;
    tagLoaded = true;
    window.atOptions = { ...AD_OPTIONS, params: {} };
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = AD_SCRIPT_URL;
    script.async = false;
    script.addEventListener("error", () => {
      tagLoaded = false;
      adSlot.replaceChildren();
      root.hidden = true;
    }, { once: true });
    adSlot.append(script);
    setTimeout(() => {
      if (tagLoaded && !adSlot.querySelector("iframe")) {
        tagLoaded = false;
        adSlot.replaceChildren();
        root.hidden = true;
      }
    }, 5_000);
  }

  function render() {
    eligible = hasResults && desktopMedia.matches;
    root.hidden = !eligible;
    adSlot.hidden = !eligible;
    if (eligible) loadTag();
  }

  desktopMedia.addEventListener("change", render);
  render();
  return {
    setEligible(value) {
      hasResults = Boolean(value);
      render();
    }
  };
}
