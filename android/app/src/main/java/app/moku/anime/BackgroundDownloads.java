package app.moku.anime;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;

/**
 * Background-download control: the user toggle, the battery-optimization
 * exemption that keeps OEM managers from killing an in-flight download, and the
 * periodic recovery job that resumes work after the process is restarted.
 */
final class BackgroundDownloads {
    static final String PREF="moku_background", RECOVERY="moku-download-recovery";
    private BackgroundDownloads() {}
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREF,Context.MODE_PRIVATE);}
    static boolean enabled(Context c){return prefs(c).getBoolean("enabled",true);}
    static void setEnabled(Context c,boolean v){prefs(c).edit().putBoolean("enabled",v).apply();}

    /** "exempt" when the app is whitelisted from battery optimization, "restricted" otherwise. */
    static String batteryStatus(Context c) {
        try {
            if(Build.VERSION.SDK_INT>=23) {
                PowerManager pm=(PowerManager)c.getSystemService(Context.POWER_SERVICE);
                if(pm!=null&&pm.isIgnoringBatteryOptimizations(c.getPackageName()))return "exempt";
            }
        }catch(Exception ignored) { }
        return "restricted";
    }

    /**
     * Request the system battery-optimization exemption dialog. Called from the
     * foreground (MainActivity) so the system dialog can be shown.
     */
    static void requestExemption(Context c) {
        try {
            if(Build.VERSION.SDK_INT>=23) {
                String packageName=c.getPackageName();
                PowerManager pm=(PowerManager)c.getSystemService(Context.POWER_SERVICE);
                if(pm!=null&&!pm.isIgnoringBatteryOptimizations(packageName)) {
                    Intent intent=new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                        .setData(Uri.parse("package:"+packageName))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    c.startActivity(intent);
                }
            }
        }catch(Exception ignored) { }
    }

    /** Schedule the periodic recovery while work is pending; cancel it once the queue is empty. */
    static void refresh(Context c) {
        try {
            WorkManager wm=WorkManager.getInstance(c);
            if(!enabled(c)||!OfflineStore.hasPendingRecovery(c)) {
                wm.cancelUniqueWork(RECOVERY);
                return;
            }
            PeriodicWorkRequest work=new PeriodicWorkRequest.Builder(DownloadRecoveryWorker.class,15,TimeUnit.MINUTES)
                .addTag("moku-recovery").build();
            wm.enqueueUniquePeriodicWork(RECOVERY,ExistingPeriodicWorkPolicy.KEEP,work);
        }catch(Exception ignored) { }
    }

    static JSONObject status(Context c) throws Exception {
        return new JSONObject()
            .put("enabled",enabled(c))
            .put("batteryOptimization",batteryStatus(c));
    }
}
