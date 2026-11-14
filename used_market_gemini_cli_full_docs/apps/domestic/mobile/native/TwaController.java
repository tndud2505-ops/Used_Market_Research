package com.usedpick.app;

import android.content.ComponentName;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.trusted.TrustedWebActivityIntent;
import androidx.browser.trusted.TrustedWebActivityIntentBuilder;
import com.google.androidbrowserhelper.trusted.FocusActivity;
import com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity;
import com.google.androidbrowserhelper.trusted.QualityEnforcer;
import com.google.androidbrowserhelper.trusted.SessionStore;
import com.google.androidbrowserhelper.trusted.SharedPreferencesTokenStore;
import com.google.androidbrowserhelper.trusted.TwaLauncher;
import com.google.androidbrowserhelper.trusted.TwaProviderPicker;
import com.google.androidbrowserhelper.trusted.TwaSharedPreferencesManager;
import androidx.browser.trusted.Token;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** Owns the same session used to build the TWA; no second tab or reflection. */
final class TwaController {
    private static final String NAMESPACE = "used-pick:ad-bridge";
    private static final Uri ORIGIN = Uri.parse("https://used-pick.com");
    private final LauncherActivity owner;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final String provider;
    private final boolean twaCapable;
    private CustomTabsSession session;
    private TrustedWebActivityIntentBuilder pending;
    private boolean bound, destroyed, validated, navigated, requested, channel, authenticated, shown;
    private String nonce = UUID.randomUUID().toString();
    private long sequence;

    TwaController(LauncherActivity owner) {
        this.owner = owner;
        TwaProviderPicker.Action action = TwaProviderPicker.pickProvider(owner.getPackageManager());
        provider = action.provider;
        twaCapable = action.launchMode == TwaProviderPicker.LaunchMode.TRUSTED_WEB_ACTIVITY;
    }

    static boolean isOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && "used-pick.com".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null;
    }

    String provider() { return provider == null ? "" : provider; }
    String nonce() { return nonce; }
    boolean isAuthenticated() { return authenticated && channel && validated && !destroyed; }
    boolean isTabShown() { return shown; }

    void open(TrustedWebActivityIntentBuilder builder) {
        if (destroyed || owner.isFinishing()) return;
        pending = builder;
        if (session != null) { launchPending(); return; }
        if (!twaCapable || provider == null) { fallback(); return; }
        if (!bound) {
            try {
                bound = CustomTabsClient.bindCustomTabsServicePreservePriority(owner, provider, connection);
            } catch (RuntimeException error) { bound = false; }
            if (!bound) fallback();
        }
    }

    private final CustomTabsServiceConnection connection = new CustomTabsServiceConnection() {
        @Override public void onCustomTabsServiceConnected(ComponentName name, CustomTabsClient client) {
            if (destroyed) return;
            try {
                client.warmup(0L); // Required for RELATION_USE_AS_ORIGIN validation, even on new Chrome.
                session = client.newSession(callback, SessionStore.makeSessionId(owner.getTaskId()));
                if (session == null) { fallback(); return; }
                session.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN, ORIGIN, null);
                launchPending();
            } catch (RuntimeException error) { fallback(); }
        }
        @Override public void onServiceDisconnected(ComponentName name) {
            session = null;
            validated = false;
            shown = false;
            resetDocument();
        }
    };

    private void launchPending() {
        if (pending == null || session == null || destroyed) return;
        TrustedWebActivityIntentBuilder builder = pending;
        pending = null;
        resetDocument();
        TrustedWebActivityIntent intent = builder.build(session);
        FocusActivity.addToIntent(intent.getIntent(), owner);
        new SharedPreferencesTokenStore(owner).store(Token.create(provider, owner.getPackageManager()));
        try {
            intent.launchTrustedWebActivity(owner); // Also forwards the builder's content URI grants.
            owner.browserLaunched();
            new TwaSharedPreferencesManager(owner).writeLastLaunchedProviderPackageName(provider);
            ManageDataLauncherActivity.addSiteSettingsShortcut(owner, provider);
        } catch (RuntimeException error) {
            pending = builder;
            fallback();
        }
    }

    private void fallback() {
        if (pending == null || destroyed || owner.isFinishing()) return;
        TrustedWebActivityIntentBuilder builder = pending;
        pending = null;
        validated = false;
        shown = false;
        resetDocument();
        new SharedPreferencesTokenStore(owner).store(null);
        // ABH's original Custom Tabs/browser fallback, never WebView.
        TwaLauncher.CCT_FALLBACK_STRATEGY.launch(owner, builder, provider, owner::browserLaunched);
    }

    private final QualityEnforcer callback = new QualityEnforcer() {
        @Override public void onRelationshipValidationResult(int relation, Uri origin, boolean result, Bundle extras) {
            main.post(() -> {
                if (destroyed || relation != CustomTabsService.RELATION_USE_AS_ORIGIN || !ORIGIN.equals(origin)) return;
                validated = result;
                if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Origin validation=" + result);
                if (!result) resetDocument();
                requestChannel();
            });
        }
        @Override public void onNavigationEvent(int event, Bundle extras) {
            main.post(() -> {
                if (destroyed) return;
                if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Browser event=" + event);
                if (event == NAVIGATION_STARTED) resetDocument();
                if (event == NAVIGATION_FINISHED) { navigated = true; requestChannel(); }
                if (event == TAB_SHOWN) shown = true;
                if (event == TAB_HIDDEN) shown = false;
            });
        }
        @Override public void onMessageChannelReady(Bundle extras) {
            main.post(() -> {
                if (destroyed || !validated || !navigated || !requested) return;
                channel = true;
                if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Message channel ready");
                try {
                    JSONObject hello = message("used-pick:native-ready");
                    hello.put("nonce", nonce);
                    send(hello);
                } catch (JSONException ignored) { }
            });
        }
        @Override public void onPostMessage(String payload, Bundle extras) {
            main.post(() -> receive(payload));
        }
    };

    private void resetDocument() {
        navigated = requested = channel = authenticated = false;
        sequence = 0;
        nonce = UUID.randomUUID().toString();
    }

    private void requestChannel() {
        if (destroyed || session == null || !validated || !navigated || requested) return;
        requested = session.requestPostMessageChannel(ORIGIN, ORIGIN, new Bundle());
        if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Message channel requested=" + requested);
    }

    private void receive(String payload) {
        if (!channel || !validated || destroyed || payload == null || payload.length() > 4096) return;
        try {
            JSONObject json = new JSONObject(payload);
            // Namespace is optional for the agreed literal v1 messages, exact when supplied.
            if (json.has("namespace") && !NAMESPACE.equals(json.optString("namespace"))) return;
            if (!(json.opt("version") instanceof Number)
                    || ((Number) json.get("version")).doubleValue() != 1
                    || !nonce.equals(json.optString("nonce"))) return;
            Object raw = json.opt("sequence");
            if (!(raw instanceof Number)) return;
            double value = ((Number) raw).doubleValue();
            long next = ((Number) raw).longValue();
            if (next < 1 || next > 9007199254740991L || value != (double) next || next <= sequence) return;
            String type = json.optString("type");
            if (!authenticated) {
                if (!"used-pick:bridge-ready".equals(type) || next != 1) return;
                authenticated = true;
                if (BuildConfig.DEBUG) Log.d("UsedPickAds", "Bridge authenticated");
                sequence = next;
                sendPrivacy(AdManager.get(owner).privacyRequired());
                return;
            }
            if (!"used-pick:analysis-complete".equals(type) && !"used-pick:privacy-options".equals(type)) return;
            sequence = next;
            if (!owner.browserForeground()) return;
            if ("used-pick:analysis-complete".equals(type)) AdManager.get(owner).completed(owner);
            else AdManager.get(owner).openPrivacy(owner);
        } catch (JSONException ignored) { /* Malformed/untrusted input never launches UI. */ }
    }

    private JSONObject message(String type) throws JSONException {
        return new JSONObject().put("namespace", NAMESPACE).put("type", type).put("version", 1);
    }

    void sendPrivacy(boolean required) {
        if (!isAuthenticated()) return;
        try { send(message("used-pick:privacy-required").put("required", required)); }
        catch (JSONException ignored) { }
    }

    private void send(JSONObject json) {
        if (session == null || !channel || destroyed) return;
        try { session.postMessage(json.toString(), null); }
        catch (RuntimeException error) { Log.w(NAMESPACE, "Browser message channel unavailable"); }
    }

    void destroy() {
        destroyed = true;
        shown = validated = false;
        resetDocument();
        if (bound) {
            owner.unbindService(connection);
            bound = false;
        }
        session = null;
        pending = null;
    }
}
