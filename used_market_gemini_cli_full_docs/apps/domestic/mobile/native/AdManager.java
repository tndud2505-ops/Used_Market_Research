package com.usedpick.app;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;
import com.google.android.libraries.ads.mobile.sdk.MobileAds;
import com.google.android.libraries.ads.mobile.sdk.common.AdLoadCallback;
import com.google.android.libraries.ads.mobile.sdk.common.AdRequest;
import com.google.android.libraries.ads.mobile.sdk.common.LoadAdError;
import com.google.android.libraries.ads.mobile.sdk.initialization.InitializationConfig;
import com.google.android.libraries.ads.mobile.sdk.interstitial.InterstitialAd;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;
import java.lang.ref.WeakReference;

/** Main-thread state; only SDK initialization runs on our background thread. */
final class AdManager {
    private static final String APP_ID = BuildConfig.ADMOB_APP_ID;
    private static final long COOLDOWN = 10 * 60_000L;
    private static final long CACHE_LIFETIME = 55 * 60_000L;
    private static final long UI_LIFETIME = 2_000L;
    private static AdManager instance;
    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ConsentInformation consent;
    private final SharedPreferences preferences;
    private final int boot;
    private final String unit;
    private WeakReference<LauncherActivity> consentOwner = new WeakReference<>(null);
    private boolean initializing, initialized, loading;
    private int completions;
    private long lastShown = -1, loadedAt;
    private InterstitialAd cached;
    private PendingUi pending;
    private WeakReference<AdHostActivity> activeHost = new WeakReference<>(null);

    static AdManager get(Context context) {
        if (instance == null) instance = new AdManager(context.getApplicationContext());
        return instance;
    }

    private AdManager(Context context) {
        this.context = context;
        consent = UserMessagingPlatform.getConsentInformation(context);
        unit = BuildConfig.ADMOB_UNIT_ID;
        preferences = context.getSharedPreferences("usedpick.ad-cadence", Context.MODE_PRIVATE);
        boot = Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT, -1);
        long saved = preferences.getLong("shownElapsed", -1);
        if (boot >= 0 && preferences.getInt("boot", -2) == boot
                && saved >= 0 && saved <= SystemClock.elapsedRealtime()) lastShown = saved;
    }

    void updateConsent(LauncherActivity owner) {
        consentOwner = new WeakReference<>(owner);
        consent.requestConsentInfoUpdate(owner, new ConsentRequestParameters.Builder().build(),
            () -> main.post(this::consentChanged),
            error -> main.post(() -> {
                Log.w("UsedPickAds", "Consent update failed; requesting ads only if UMP permits");
                consentChanged();
            }));
        // UMP may permit requests using the previous session's consent after update is requested.
        consentChanged();
    }

    boolean privacyRequired() {
        return consent.getConsentStatus() == ConsentInformation.ConsentStatus.REQUIRED
                || consent.getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
    }

    private void consentChanged() {
        LauncherActivity owner = consentOwner.get();
        if (owner != null && !owner.isDestroyed()) owner.notifyPrivacy(privacyRequired());
        if (!consent.canRequestAds()) {
            if (cached != null) { cached.destroy(); cached = null; }
            // Required consent is collected by the explicit privacy bridge action. No launch delay,
            // debug-geography override, consent reset, or local "consent granted" substitute.
            Log.i("UsedPickAds", "Ads unavailable until UMP canRequestAds is true");
            return;
        }
        if (!initialized && !initializing) {
            initializing = true;
            new Thread(() -> {
                try {
                    MobileAds.initialize(context, new InitializationConfig.Builder(APP_ID).build(),
                        status -> main.post(() -> {
                            initializing = false;
                            initialized = true;
                            if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Ads SDK initialized");
                            load();
                        }));
                } catch (RuntimeException error) {
                    main.post(() -> {
                        initializing = false;
                        Log.w("UsedPickAds", "Ads initialization unavailable");
                    });
                }
            }, "used-pick-ads-init").start();
        } else if (initialized) load();
    }

    private void load() {
        if (!initialized || !consent.canRequestAds() || loading || cached != null) return;
        loading = true;
        try { InterstitialAd.load(new AdRequest.Builder(unit).build(), new AdLoadCallback<InterstitialAd>() {
            @Override public void onAdLoaded(InterstitialAd ad) {
                main.post(() -> {
                    loading = false;
                    if (!consent.canRequestAds()) { ad.destroy(); return; }
                    cached = ad;
                    if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Test interstitial cached");
                    loadedAt = SystemClock.elapsedRealtime();
                    // Loading completes only into the cache. It never revives a missed opportunity.
                });
            }
            @Override public void onAdFailedToLoad(LoadAdError error) {
                main.post(() -> {
                    loading = false;
                    Log.i("UsedPickAds", "No interstitial available; web flow continues");
                    if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Test ad response: " + error.getMessage());
                });
            }
        }); } catch (RuntimeException error) {
            loading = false;
            Log.w("UsedPickAds", "Ad request unavailable; web flow continues");
        }
    }

    void completed(LauncherActivity owner) {
        completions = (completions + 1) % 3;
        boolean opportunity = completions == 0;
        if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Completion: opportunity=" + opportunity
                + " foreground=" + owner.browserForeground() + " consent=" + consent.canRequestAds()
                + " cached=" + (cached != null));
        long now = SystemClock.elapsedRealtime();
        if (cached != null && now - loadedAt >= CACHE_LIFETIME) { cached.destroy(); cached = null; }
        if (!opportunity || !owner.browserForeground() || !consent.canRequestAds()
                || hasUi() || (lastShown >= 0 && now - lastShown < COOLDOWN)) {
            load();
            return;
        }
        if (cached == null) { load(); return; } // Do not even open the host on no-fill.
        InterstitialAd ready = cached;
        cached = null;
        launchUi(owner, ready, false);
    }

    void openPrivacy(LauncherActivity owner) {
        if (privacyRequired() && !hasUi() && owner.browserForeground()) launchUi(owner, null, true);
    }

    private void launchUi(LauncherActivity owner, InterstitialAd ad, boolean privacy) {
        PendingUi request = new PendingUi(owner, ad, privacy);
        pending = request;
        try {
            // Explicit, non-exported, same-task host. No URL, PendingIntent, or task-clearing flags.
            owner.startActivity(new Intent(owner, AdHostActivity.class));
        } catch (RuntimeException error) { discard(request); }
        // BAL may decline without throwing. Expire an unclaimed request instead of replaying later.
        main.postDelayed(() -> { if (pending == request) discard(request); }, UI_LIFETIME);
    }

    PendingUi claim(AdHostActivity host) {
        PendingUi request = pending;
        if (request == null) return null;
        LauncherActivity owner = request.owner.get();
        ActivityManager.RecentTaskInfo task = owner == null ? null : owner.ownTask();
        if (SystemClock.elapsedRealtime() - request.createdAt > UI_LIFETIME || owner == null
                || !owner.bridgeActive() || !request.nonce.equals(owner.bridgeNonce())
                || !owner.screenInteractive() || host.getTaskId() != request.taskId
                || task == null || task.topActivity == null
                || !host.getComponentName().equals(task.topActivity)
                || (Build.VERSION.SDK_INT >= 32 && !task.isVisible())
                || (!request.privacy && !consent.canRequestAds())) {
            discard(request);
            return null;
        }
        pending = null;
        activeHost = new WeakReference<>(host);
        return request;
    }

    private void discard(PendingUi request) {
        if (pending == request) pending = null;
        if (request.ad != null) request.ad.destroy();
    }

    boolean hasUi() { return pending != null || activeHost.get() != null; }
    boolean hasUiFor(LauncherActivity owner) {
        return (pending != null && pending.owner.get() == owner)
                || (activeHost.get() != null && activeHost.get().getTaskId() == owner.getTaskId());
    }

    void shown() {
        lastShown = SystemClock.elapsedRealtime();
        preferences.edit().putLong("shownElapsed", lastShown).putInt("boot", boot).apply();
    }

    void showPrivacy(AdHostActivity host, Runnable finished) {
        if (consent.getConsentStatus() == ConsentInformation.ConsentStatus.REQUIRED) {
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(host,
                error -> main.post(() -> { consentChanged(); finished.run(); }));
        } else {
            UserMessagingPlatform.showPrivacyOptionsForm(host,
                error -> main.post(() -> { consentChanged(); finished.run(); }));
        }
    }

    void finished(AdHostActivity host) {
        if (activeHost.get() == host) activeHost.clear();
        load();
    }

    static final class PendingUi {
        final WeakReference<LauncherActivity> owner;
        final int taskId;
        final String nonce;
        final long createdAt = SystemClock.elapsedRealtime();
        final InterstitialAd ad;
        final boolean privacy;
        PendingUi(LauncherActivity owner, InterstitialAd ad, boolean privacy) {
            this.owner = new WeakReference<>(owner);
            taskId = owner.getTaskId();
            nonce = owner.bridgeNonce();
            this.ad = ad;
            this.privacy = privacy;
        }
    }
}
