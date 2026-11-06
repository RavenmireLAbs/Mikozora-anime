package app.moku.anime;

import android.app.Application;
import androidx.annotation.NonNull;
import androidx.work.Configuration;
import java.util.concurrent.Executors;

/** Two resolver workers at most, so short-lived signed links are not prepared far ahead of the queue. */
public final class MokuApplication extends Application implements Configuration.Provider {
    private final Configuration workConfig=new Configuration.Builder()
        .setExecutor(Executors.newFixedThreadPool(2)).build();
    @NonNull @Override public Configuration getWorkManagerConfiguration() { return workConfig; }
    @Override public void onCreate() {
        super.onCreate();
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
