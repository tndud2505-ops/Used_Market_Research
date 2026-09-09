export function createAdfitSlot(root) {
  if (!root) return { setEligible() {} };

  let eligible = false;
  const hasCreative = () => Boolean(root.querySelector("iframe, .kakao_ad_area > *"));
  const sync = () => { root.hidden = !(eligible && hasCreative()); };
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  root.hidden = true;

  return {
    setEligible(value) {
      eligible = Boolean(value);
      sync();
    },
  };
}
