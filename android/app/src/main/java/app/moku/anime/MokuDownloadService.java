package app.moku.anime;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Intent;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DownloadNotificationHelper;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.scheduler.PlatformScheduler;
import androidx.media3.exoplayer.scheduler.Scheduler;
import java.util.List;

@OptIn(markerClass = UnstableApi.class)
public final class MokuDownloadService extends DownloadService {
    static final String CHANNEL="moku_downloads";
    public MokuDownloadService() { super(1001,DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,CHANNEL,R.string.download_channel,0); }
    @Override protected DownloadManager getDownloadManager() {
        DownloadManager m=OfflineStore.manager(this);m.resumeDownloads();return m;
    }
    @Nullable @Override protected Scheduler getScheduler() { return new PlatformScheduler(this,9183); }
    @Override protected Notification getForegroundNotification(List<Download> downloads,int notMetRequirements) {
        Intent intent=new Intent(this,MainActivity.class);
        PendingIntent pending=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        return new DownloadNotificationHelper(this,CHANNEL).buildProgressNotification(this,android.R.drawable.stat_sys_download,pending,"Downloading episodes",downloads,notMetRequirements);
    }
}
