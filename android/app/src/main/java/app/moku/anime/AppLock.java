package app.moku.anime;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.Window;
import android.view.WindowManager;
import org.json.JSONObject;

/** Device-credential app lock. Authentication is handled by Android, never by Mikozora. */
final class AppLock {
    private static final String PREFS = "moku_private_lock_v1";
    private static final String ENABLED = "enabled";
    // A cold process always starts locked. The Application lifecycle also sets
    // this whenever every app screen has left the foreground.
    private static volatile boolean requiresUnlock = true;

    private AppLock() {}

    static boolean deviceSecure(Context context) {
        try {
            KeyguardManager manager = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
            return manager != null && manager.isDeviceSecure();
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean enabled(Context context) {
        try { return prefs(context).getBoolean(ENABLED, false); }
        catch (Exception ignored) { return false; }
    }

    static JSONObject state(Context context) {
        boolean secure = deviceSecure(context);
        boolean active = enabled(context) && secure;
        if (enabled(context) && !secure) setEnabled(context, false);
        try {
            return new JSONObject().put("available", true).put("enabled", active)
                .put("deviceSecure", secure).put("method", "device");
        } catch (Exception impossible) { return new JSONObject(); }
    }

    /** Returns false if the device has no configured PIN, pattern, or password. */
    static boolean setEnabled(Context context, boolean value) {
        if (value && !deviceSecure(context)) return false;
        try {
            boolean saved = prefs(context).edit().putBoolean(ENABLED, value).commit();
            if (!value) requiresUnlock = false;
            else requiresUnlock = false; // enabling from inside the unlocked app takes effect on next background.
            HomeWidgetProvider.refreshAll(context);
            return saved;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean requiresUnlock() { return requiresUnlock; }
    static void requireUnlock(Context context) { if (enabled(context)) requiresUnlock = true; }
    static void authenticated() { requiresUnlock = false; }

    static void applyScreenshotProtection(Context context, Window window) {
        if (window == null) return;
        if (enabled(context)) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}
