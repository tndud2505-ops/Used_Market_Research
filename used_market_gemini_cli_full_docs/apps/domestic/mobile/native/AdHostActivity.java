package com.usedpick.app;

import android.app.Activity;
import android.os.Bundle;
import com.google.android.libraries.ads.mobile.sdk.common.FullScreenContentError;
import com.google.android.libraries.ads.mobile.sdk.interstitial.InterstitialAd;
import com.google.android.libraries.ads.mobile.sdk.interstitial.InterstitialAdEventCallback;

/** Internal one-shot UI. Finishing reveals the exact Chrome Activity already below it. */
public final class AdHostActivity extends Activity {
    private boolean resumed, attempted, released;
    private InterstitialAd ad;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) finish(); // Never replay an ad following process restoration.
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (hasWindowFocus()) present();
    }

    @Override protected void onPause() {
        resumed = false;
        super.onPause();
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused && resumed) present();
    }

    private void present() {
        if (attempted || isFinishing()) return;
        attempted = true;
        AdManager manager = AdManager.get(this);
        AdManager.PendingUi request = manager.claim(this);
        if (request == null) { finish(); return; }
        if (request.privacy) {
            manager.showPrivacy(this, this::finish);
            return;
        }
        ad = request.ad;
        if (ad == null) { finish(); return; }
        ad.setAdEventCallback(new InterstitialAdEventCallback() {
            @Override public void onAdShowedFullScreenContent() {
                runOnUiThread(manager::shown);
            }
            @Override public void onAdDismissedFullScreenContent() {
                runOnUiThread(AdHostActivity.this::finish);
            }
            @Override public void onAdFailedToShowFullScreenContent(FullScreenContentError error) {
                runOnUiThread(AdHostActivity.this::finish);
            }
        });
        try { ad.show(this); }
        catch (RuntimeException error) { finish(); }
    }

    @Override protected void onDestroy() {
        if (!released) {
            released = true;
            if (ad != null) { ad.destroy(); ad = null; }
            AdManager.get(this).finished(this);
        }
        super.onDestroy();
    }
}
