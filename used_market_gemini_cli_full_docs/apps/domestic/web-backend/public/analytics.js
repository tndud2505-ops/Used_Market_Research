(() => {
  if (window.usedPickAnalyticsInitialized) return;
  window.usedPickAnalyticsInitialized = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', 'G-2L2ETG06B1', {
    allow_google_signals: false,
    allow_ad_personalization_signals: false
  });
})();
