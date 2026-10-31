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
    }
}
