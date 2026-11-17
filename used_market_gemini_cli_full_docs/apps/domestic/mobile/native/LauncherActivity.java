package com.usedpick.app;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.widget.ImageView;
import androidx.browser.trusted.FileHandlingData;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;
import com.google.androidbrowserhelper.trusted.LauncherActivityMetadata;
import com.google.androidbrowserhelper.trusted.splashscreens.PwaWrapperSplashScreenStrategy;
import java.lang.ref.WeakReference;
import java.util.Collections;
import java.util.List;

/** The sole native owner stays below Chrome; Chrome still owns all web state. */
public class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    private static WeakReference<LauncherActivity> owner = new WeakReference<>(null);
    private TwaController controller;
    private PwaWrapperSplashScreenStrategy splash;
    private boolean launched;
    private boolean leftForBrowser;

    @Override protected boolean shouldLaunchImmediately() { return false; }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        if (isFinishing()) return; // Retain ABH task/launcher-icon routing.
        // A process-restored owner reached by closing Chrome must not reopen its start URL.
        if (state != null && state.getBoolean("usedpick.browserLaunched")) {
            finish();
            return;
        }
        TrustedWebActivityIntentBuilder builder = createBuilder();
        LauncherActivity existing = owner.get();
        if (existing != null && existing != this && !existing.isFinishing()
                && existing.controller != null) {
            existing.controller.open(builder);
            finish();
            return;
        }
        owner = new WeakReference<>(this);
        // Chrome keeps this plain white screen above its own toolbar until the page paints, so
        // the address bar is not visible while the browser starts. A launch into a task that is
        // already running has nothing to cover and shows no splash.
        if (isTaskRoot()) {
            splash = new PwaWrapperSplashScreenStrategy(this, R.drawable.transparent_splash_icon,
                    Color.WHITE, ImageView.ScaleType.CENTER, null,
                    getResources().getInteger(R.integer.splashScreenFadeOutDuration),
                    getString(R.string.providerAuthority), false);
        }
        controller = new TwaController(this, splash);
        // Consent updates and ad loading never hold the browser launch.
        AdManager.get(this).updateConsent(this);
        controller.open(builder);
    }

    private TrustedWebActivityIntentBuilder createBuilder() {
        LauncherActivityMetadata metadata = LauncherActivityMetadata.parse(this);
        TrustedWebActivityIntentBuilder builder = new TrustedWebActivityIntentBuilder(getLaunchingUrl());
        metadata.configureIntentBuilder(builder, this);
        builder.setDisplayMode(getDisplayMode());
        Uri original = getUrlForIntent(getIntent());
        if (original != null && !original.equals(getLaunchingUrl())
                && (("https".equalsIgnoreCase(original.getScheme()) && isTrustedIntentUrl(original))
                || ("content".equalsIgnoreCase(original.getScheme()) && isTrustedContentUri(original)))) {
            builder.setOriginalLaunchUrl(original);
        }
        // Keep ABH's all-or-nothing external read-grant check. Share/notifications stay disabled.
        List<Uri> files = null;
        if (getIntent().hasExtra(TrustedWebActivityIntentBuilder.EXTRA_FILE_HANDLING_DATA)) {
            Bundle bundle = getIntent().getBundleExtra(TrustedWebActivityIntentBuilder.EXTRA_FILE_HANDLING_DATA);
            if (bundle != null) files = FileHandlingData.fromBundle(bundle).uris;
        } else if (original != null && "content".equalsIgnoreCase(original.getScheme())) {
            files = Collections.singletonList(original);
        }
        if (files != null && !files.isEmpty()) {
            boolean granted = true;
            for (Uri uri : files) if (!isTrustedContentUri(uri)) granted = false;
            if (granted) builder.setFileHandlingData(new FileHandlingData(files));
        }
        return builder;
    }

    @Override protected boolean isTrustedIntentUrl(Uri uri) {
        return TwaController.isOrigin(uri);
    }

    void browserLaunched() { launched = true; }

    @Override public void onEnterAnimationComplete() {
        super.onEnterAnimationComplete();
        // The splash strategy starts Chrome only after this activity finished entering.
        if (splash != null) splash.onActivityEnterAnimationComplete();
    }

    @Override protected void onPause() {
        if (launched) leftForBrowser = true;
        super.onPause();
    }

    @Override protected void onPostResume() {
        super.onPostResume();
        // A delayed focus callback during Chrome's launch is not an Activity return.
        // End ownership only when this launcher actually resumes from the browser.
        if (launched && leftForBrowser && !AdManager.get(this).hasUiFor(this)) finish();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putBoolean("usedpick.browserLaunched", launched);
    }

    @Override protected void onDestroy() {
        if (controller != null) controller.destroy();
        if (splash != null) splash.destroy();
        if (owner.get() == this) owner.clear();
        super.onDestroy();
    }

    boolean bridgeActive() {
        return !isFinishing() && !isDestroyed() && controller != null && controller.isAuthenticated();
    }

    String bridgeNonce() { return controller == null ? "" : controller.nonce(); }

    boolean browserForeground() {
        if (!bridgeActive() || !controller.isTabShown() || !screenInteractive()) return false;
        ActivityManager.RecentTaskInfo task = ownTask();
        if (task == null || task.topActivity == null
                || !controller.provider().equals(task.topActivity.getPackageName())) return false;
        // isVisible() is public starting at API 32. Earlier versions rely on the browser's
        // TAB_SHOWN/TAB_HIDDEN lifecycle plus exact own-task top activity, never recency alone.
        return Build.VERSION.SDK_INT < 32 || task.isVisible();
    }

    boolean screenInteractive() {
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        KeyguardManager lock = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        return power != null && power.isInteractive() && lock != null && !lock.isKeyguardLocked();
    }

    ActivityManager.RecentTaskInfo ownTask() {
        ActivityManager manager = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
        if (manager == null) return null;
        try {
            for (ActivityManager.AppTask task : manager.getAppTasks()) {
                ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                if (info.id == getTaskId()) return info;
            }
        } catch (RuntimeException ignored) { /* No visibility proof means no native UI. */ }
        return null;
    }

    void notifyPrivacy(boolean required) {
        if (controller != null) controller.sendPrivacy(required);
    }
}
