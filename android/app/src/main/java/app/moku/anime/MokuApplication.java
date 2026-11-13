package app.moku.anime;

import android.app.Activity;
import android.app.Application;
import android.content.Intent;
import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.work.Configuration;
import java.util.concurrent.Executors;

/** Two resolver workers at most, so short-lived signed links are not prepared far ahead of the queue. */
public final class MokuApplication extends Application implements Configuration.Provider {
    private final Configuration workConfig=new Configuration.Builder()
        .setExecutor(Executors.newFixedThreadPool(2)).build();
    @NonNull @Override public Configuration getWorkManagerConfiguration() { return workConfig; }
    private int startedActivities;

    @Override public void onCreate() {
        super.onCreate();
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override public void onActivityStarted(Activity activity) {
                if (activity instanceof AppLockActivity) return;
                boolean enteringForeground = startedActivities++ == 0;
                AppLock.applyScreenshotProtection(MokuApplication.this, activity.getWindow());
                if (enteringForeground && AppLock.enabled(MokuApplication.this) && AppLock.requiresUnlock()) {
                    Intent gate = new Intent(activity, AppLockActivity.class);
                    gate.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION);
                    try { activity.startActivity(gate); } catch (Exception ignored) { }
                }
            }
            @Override public void onActivityStopped(Activity activity) {
                if (activity instanceof AppLockActivity) return;
                startedActivities = Math.max(0, startedActivities - 1);
                if (startedActivities == 0 && !activity.isChangingConfigurations()) AppLock.requireUnlock(MokuApplication.this);
            }
            @Override public void onActivityResumed(Activity activity) {
                AppLock.applyScreenshotProtection(MokuApplication.this, activity.getWindow());
            }
            @Override public void onActivityCreated(Activity activity, Bundle state) { }
            @Override public void onActivityPaused(Activity activity) { }
            @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) { }
            @Override public void onActivityDestroyed(Activity activity) { }
        });
        // Media3's manager is tied to the main application looper.
        OfflineStore.manager(this);
        // Resume any downloads or folder copies interrupted by a process restart,
        // and keep the periodic recovery job alive while work is pending. This runs
        // off the main thread because it reads persisted state and enqueues workers.
        new Thread(() -> {
            try { OfflineStore.recover(this,true); }catch(Exception ignored) { }
            try { BackgroundDownloads.refresh(this); }catch(Exception ignored) { }
        },"moku-startup-recovery").start();
    }
}
