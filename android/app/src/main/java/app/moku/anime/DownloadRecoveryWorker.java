package app.moku.anime;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONObject;

/**
 * Periodic safety net that re-drives downloads and folder copies the process
 * could not finish. WorkManager restarts the app process to run this, which
 * also triggers MokuApplication.onCreate's full startup recovery; this worker
 * then re-enqueues anything still queued and trims the periodic job once the
 * queue is empty so the app does not wake up needlessly.
 */
public final class DownloadRecoveryWorker extends Worker {
    public DownloadRecoveryWorker(@NonNull Context context,@NonNull WorkerParameters params) { super(context,params); }
    @NonNull @Override public Result doWork() {
        Context c=getApplicationContext();
        try { OfflineStore.recover(c,false); }catch(Exception ignored) { }
        try { BackgroundDownloads.refresh(c); }catch(Exception ignored) { }
        return Result.success();
    }
}
