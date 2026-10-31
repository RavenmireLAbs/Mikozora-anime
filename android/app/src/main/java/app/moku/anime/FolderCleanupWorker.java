package app.moku.anime;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.offline.Download;
import androidx.work.BackoffPolicy;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.ForegroundInfo;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.concurrent.TimeUnit;

/** Verifies the folder files before deleting a private episode. Safe to retry after interruption. */
@OptIn(markerClass=UnstableApi.class)
public final class FolderCleanupWorker extends Worker {
    public FolderCleanupWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
    static String name(String id){return "moku-verify-cleanup-"+id;}
    static void schedule(Context c,String id){schedule(c,id,false);}
    static void schedule(Context c,String id,boolean replace){
        OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(FolderCleanupWorker.class)
            .setInputData(new Data.Builder().putString("id",id).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.SECONDS).addTag("moku-cleanup").build();
        WorkManager.getInstance(c).enqueueUniqueWork(name(id),replace?ExistingWorkPolicy.REPLACE:ExistingWorkPolicy.KEEP,work);
    }
    @NonNull @Override public Result doWork(){
        Context c=getApplicationContext();String id=getInputData().getString("id");
        if(id==null||!id.matches("[a-f0-9]{32}"))return Result.failure();
        try {
            JSONObject meta=OfflineStore.get(c,id);if(meta==null)return Result.success();
            JSONObject pending=meta.optJSONObject("pendingExport");
            if(pending==null&&(!"folder".equals(meta.optString("storageMode"))||"complete".equals(meta.optString("cleanupStatus"))))return Result.success();
            setForegroundAsync(foregroundInfo(c,meta,id)).get();boolean checked=false;
            if(pending!=null&&"verifying".equals(meta.optString("exportStatus"))) {
                String job=pending.optString("job");
                try {
                    FolderIntegrity.verify(c,pending,()->checkPending(c,id,job));checked=true;
                }catch(Exception e){
                    if(isStopped()||Thread.currentThread().isInterrupted())return Result.retry();
                    JSONObject latest=OfflineStore.get(c,id);
                    if(latest==null||!job.equals(latest.optString("exportJob")))return Result.success();
                    synchronized(PrivateAccess.class) {
                        Download existing=OfflineStore.getDownloadStrict(c,id);
                        OfflineStore.change(c,id,data->{JSONObject staged=data.optJSONObject("pendingExport");
                            if(staged!=null&&job.equals(staged.optString("job"))) {
                                data.remove("pendingExport");data.put("exportStatus","failed");
                                data.put("exportError","Could not verify the folder files. The original was kept; a partial file may remain.");
                                if("folder".equals(data.optString("storageMode"))&&existing!=null&&existing.state==Download.STATE_COMPLETED&&!data.optBoolean("cleanupStarted",false)) {
                                    data.put("storageMode","private");data.put("cleanupStatus","retained");data.put("cleanupMessage","The newer folder copy failed verification; the private copy was kept.");
                                }
                            }});
                    }
                    return Result.success();
                }
                Download d=OfflineStore.getDownloadStrict(c,id);
                boolean scoped=d!=null&&CacheScopes.isolated(d.request);
                String keep=pending.optString("keepReason");
                boolean promoted;
                synchronized(PrivateAccess.class) {promoted=OfflineStore.change(c,id,data->{JSONObject staged=data.optJSONObject("pendingExport");
                    if(staged==null||!job.equals(staged.optString("job"))||!job.equals(data.optString("exportJob")))throw new IOException("A newer save replaced this copy.");
                    JSONObject video=staged.getJSONObject("video");JSONArray tracks=staged.optJSONArray("tracks");
                    if(tracks==null)tracks=new JSONArray();
                    data.put("verifiedExport",staged);data.put("exportUri",video.getString("uri"));data.put("exportTree",staged.getString("tree"));
                    data.put("exportFolder",staged.optString("folder"));data.put("exportSeriesFolder",staged.optString("seriesFolder"));
                    data.put("exportFilename",staged.optString("filename"));data.put("exportBytes",video.optLong("bytes"));
                    data.put("exportTracks",tracks);data.put("exportSubtitleCount",tracks.length());data.put("exportVerified",true);
                    data.put("exportStatus","completed");data.put("exportError","");data.remove("pendingExport");
                    if(!keep.isEmpty()){data.put("storageMode","private");data.put("cleanupStatus","retained");data.put("cleanupMessage",keep);}
                    else {data.put("storageMode","folder");data.put("cleanupStatus","pending");data.put("cleanupScoped",scoped||(d==null&&data.optBoolean("cleanupScoped",false)));data.put("cleanupMessage","");}
                });}
                if(!promoted||!keep.isEmpty())return Result.success();
                meta=OfflineStore.get(c,id);if(meta==null)return Result.success();
            }
            if(!"folder".equals(meta.optString("storageMode"))||"complete".equals(meta.optString("cleanupStatus")))return Result.success();
            if(PrivateAccess.inUse(id)) {
                OfflineStore.update(c,id,"cleanupStatus","waiting");
                OfflineStore.update(c,id,"cleanupMessage","The private copy will be removed after you close the in-app player.");
                return Result.retry();
            }
            JSONObject proof=meta.optJSONObject("verifiedExport");
            if(proof==null)return keepPrivate(c,id,"The folder copy could not be verified; the in-app copy was kept.");
            if(!checked)try{FolderIntegrity.verify(c,proof,()->checkExists(c,id));}
            catch(Exception e){if(isStopped())return Result.retry();return keepPrivate(c,id,"The saved folder files are unavailable; the in-app copy was kept.");}
            synchronized(PrivateAccess.class) {
                checkExists(c,id);JSONObject current=OfflineStore.get(c,id);
                if(current==null||!"folder".equals(current.optString("storageMode")))return Result.success();
                JSONObject currentProof=current.optJSONObject("verifiedExport");
                // A newer save may be in flight. Never delete the old private source for a
                // different job, or while a private player acquired its source concurrently.
                if(currentProof==null||!currentProof.optString("job").equals(current.optString("exportJob")))return Result.retry();
                if(PrivateAccess.inUse(id)) {
                    OfflineStore.update(c,id,"cleanupStatus","waiting");
                    OfflineStore.update(c,id,"cleanupMessage","The private copy will be removed after you close the in-app player.");return Result.retry();
                }
                Download d=OfflineStore.getDownloadStrict(c,id);
                if(d!=null&&d.state!=Download.STATE_COMPLETED)return Result.retry();
                if(d!=null) {
                    if(CacheScopes.isolated(d.request)) {
                        // Persist the point of no return before removing the first span.
                        if(!OfflineStore.change(c,id,data->data.put("cleanupStarted",true)))return Result.success();
                        // A completed download is terminal and not in Media3's active task list.
                        // Deleting our own namespace directly avoids unfiltered HLS removal and
                        // keeps the playback-source check and deletion in one critical section.
                        for(String key:new HashSet<>(OfflineStore.cache(c).getKeys()))
                            if(key.startsWith(CacheScopes.prefix(id)))OfflineStore.cache(c).removeResource(key);
                        ((androidx.media3.exoplayer.offline.WritableDownloadIndex)OfflineStore.manager(c).getDownloadIndex()).removeDownload(id);
                    } else {
                        try{if(!LegacyCacheCleanup.remove(c,d)){
                            OfflineStore.update(c,id,"cleanupStatus","waiting");
                            OfflineStore.update(c,id,"cleanupMessage","Waiting for older downloads to finish before safely clearing shared cache.");return Result.retry();
                        }}catch(Exception unsafe){return keepPrivate(c,id,"Could not safely clear the older shared cache; the in-app copy was kept.");}
                    }
                }
                // A process may have stopped between deleting spans and updating the index.
                if(!OfflineStore.change(c,id,data->data.put("cleanupStarted",true)))return Result.success();
                if(current.optBoolean("cleanupScoped",false))for(String key:new HashSet<>(OfflineStore.cache(c).getKeys()))
                    if(key.startsWith(CacheScopes.prefix(id)))OfflineStore.cache(c).removeResource(key);
                File subtitleDir=OfflineStore.subtitleDir(c,id);OfflineStore.deleteTree(subtitleDir);
                if(subtitleDir.exists())return Result.retry();
                OfflineStore.change(c,id,data->{data.put("cleanupStatus","complete");data.put("cleanupMessage","");data.put("tracks",new JSONArray());});
                return Result.success();
            }
        }catch(InterruptedException e){Thread.currentThread().interrupt();return Result.retry();}
        catch(Exception e){return Result.retry();}
    }
    private void checkExists(Context c,String id)throws IOException {
        if(isStopped()||Thread.currentThread().isInterrupted())throw new IOException("Interrupted");
        if(OfflineStore.get(c,id)==null)throw new IOException("Episode removed");
    }
    private void checkPending(Context c,String id,String job)throws IOException {
        checkExists(c,id);JSONObject data=OfflineStore.get(c,id);
        JSONObject staged=data==null?null:data.optJSONObject("pendingExport");
        if(data==null||!job.equals(data.optString("exportJob"))||staged==null||!job.equals(staged.optString("job")))
            throw new IOException("A newer copy replaced this save.");
    }
    private static ForegroundInfo foregroundInfo(Context c,JSONObject meta,String id) {
        String channel=MokuDownloadService.CHANNEL;
        if(Build.VERSION.SDK_INT>=26) {
            NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(channel,"Episode downloads",NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent open=PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        JSONObject item=meta.optJSONObject("item");String title=item==null?"Episode":item.optString("title","Episode");
        Notification n=new NotificationCompat.Builder(c,channel).setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Checking saved episode").setContentText(title).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).build();
        int notificationId=40000+(id.hashCode()&0x3fff);
        return Build.VERSION.SDK_INT>=29?new ForegroundInfo(notificationId,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC):new ForegroundInfo(notificationId,n);
    }
    private Result keepPrivate(Context c,String id,String message)throws Exception {
        synchronized(PrivateAccess.class) {
            Download d=OfflineStore.getDownloadStrict(c,id);
            OfflineStore.change(c,id,data->{
                boolean started=data.optBoolean("cleanupStarted",false);
                if(!started&&d!=null&&d.state==Download.STATE_COMPLETED)data.put("storageMode","private");
                data.put("cleanupStatus","retained");
                data.put("cleanupMessage",started?"Private cleanup was interrupted. If playback fails, restore folder access or re-download the episode.":message);
            });
        }
        return Result.success();
    }
}
