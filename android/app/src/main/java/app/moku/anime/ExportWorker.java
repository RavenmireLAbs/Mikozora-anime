package app.moku.anime;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.database.Cursor;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.DocumentsContract;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.Clock;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.transformer.AssetLoader;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultDecoderFactory;
import androidx.media3.transformer.ExoPlayerAssetLoader;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.InAppMuxer;
import androidx.media3.transformer.SampleConsumer;
import androidx.media3.transformer.Transformer;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Creates a verified user-owned MP4 and subtitle sidecars, then releases private storage safely. */
@OptIn(markerClass = UnstableApi.class)
public final class ExportWorker extends Worker {
    // Large remuxes/transcodes can consume memory and storage; only one external copy at a time.
    private static final Semaphore EXPORT_SLOT=new Semaphore(1,true);
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile Transformer transformer;
    private String job;
    public ExportWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}

    @NonNull @Override public Result doWork() {
        Context c=getApplicationContext();String id=getInputData().getString("id"),rawTree=getInputData().getString("tree");
        if(id==null||!id.matches("[a-f0-9]{32}")||rawTree==null)return Result.failure();
        job=getInputData().getString("job");File temp=null;boolean acquired=false,finished=false;List<Uri> created=new ArrayList<>();
        try {
            if(job==null||job.isEmpty()) {
                // A request queued by an older installed version can still finish after updating.
                job="legacy-"+getId().toString();final String legacyJob=job;
                if(!OfflineStore.change(c,id,m->{if(!m.optString("exportJob").isEmpty())throw new IOException("A newer copy is already queued.");m.put("exportJob",legacyJob);}))return Result.success();
            }
            while(!isStopped()&&!(acquired=EXPORT_SLOT.tryAcquire(1,TimeUnit.SECONDS))) { /* wait */ }
            ensureActive(c,id);
            JSONObject meta=OfflineStore.get(c,id);Download d=OfflineStore.getDownload(c,id);
            boolean fromFolder="folder".equals(meta.optString("storageMode"))&&!meta.optString("exportUri").isEmpty();
            if(!fromFolder&&(d==null||d.state!=Download.STATE_COMPLETED))throw new IOException("The in-app download is no longer available.");
            Uri tree=Uri.parse(rawTree);
            if(!ExportStore.hasPermission(c,tree))throw new IOException("Folder access was lost. Choose the folder again in Settings.");
            setForegroundAsync(foregroundInfo(meta,id)).get();
            OfflineStore.update(c,id,"exportStatus","exporting");OfflineStore.update(c,id,"exportError","");
            String keepReason="";
            if(!fromFolder) {
                File dir=new File(c.getFilesDir(),"moku_export_work");
                if(!dir.mkdirs()&&!dir.isDirectory())throw new IOException("Could not create temporary export storage.");
                File[] stale=dir.listFiles((parent,name)->name.startsWith(id+"-")&&name.endsWith(".mp4"));
                if(stale!=null)for(File old:stale)old.delete();
                temp=File.createTempFile(id+"-",".mp4",dir);
                ExportResult result=makeMp4(c,d.request,temp,id);
                ensureActive(c,id);
                if(!temp.isFile()||temp.length()<1024||result.videoConversionProcess==ExportResult.CONVERSION_PROCESS_NA)
                    throw new IOException("The episode did not produce a complete video.");
                Mp4CttsFixer.fix(temp);validateTracks(temp);
                keepReason=SubtitlePreservation.reasonToKeepPrivate(c,d);
            }
            ensureActive(c,id);
            JSONObject series=meta.optJSONObject("item");String title=series==null?"":series.optString("title","");
            String seriesFolder=SeriesFolderName.fromTitle(title);Uri folder=SeriesFolders.findOrCreate(c,tree,seriesFolder);
            String basename=fileBase(meta,id);Uri video=create(c,folder,"video/mp4",basename+".mp4",created);
            InputStream source=fromFolder?c.getContentResolver().openInputStream(Uri.parse(meta.getString("exportUri"))):new FileInputStream(temp);
            JSONObject videoInfo=FolderIntegrity.copy(c,source,video,()->ensureActive(c,id));
            JSONArray tracks=writeSubtitles(c,id,meta,folder,basename,created,fromFolder);
            ensureActive(c,id);
            String rootName=getInputData().getString("folderName");if(rootName==null||rootName.isEmpty())rootName=meta.optString("exportNextFolder",meta.optString("exportFolder"));
            JSONObject pending=new JSONObject().put("job",job).put("tree",rawTree).put("folder",rootName)
                .put("seriesFolder",seriesFolder).put("filename",basename+".mp4").put("video",videoInfo)
                .put("tracks",tracks).put("keepReason",keepReason);
            if(!OfflineStore.change(c,id,data->{if(!job.equals(data.optString("exportJob")))throw new IOException("A newer copy replaced this request.");
                data.put("pendingExport",pending);data.put("exportStatus","verifying");data.put("exportError","");}))
                throw new IOException("The episode was removed.");
            // Once recorded, the files belong to the user. A later verification failure never
            // deletes them or the private download. A queued verifier resumes after interruption.
            finished=true;
            try{FolderCleanupWorker.schedule(c,id,true);}catch(Exception ignored){}
            return Result.success();
        } catch(Exception e) {
            boolean clean=finished||deleteCreated(c,created);
            JSONObject latest=OfflineStore.get(c,id);
            if(latest!=null&&(job==null||job.equals(latest.optString("exportJob")))) {
                String message=isStopped()?"Export was interrupted. Tap Save to folder to retry.":ExportStore.safeMessage(e);
                if(!clean)message+=" A partial file may remain in the selected folder.";
                final String failure=message;
                synchronized(PrivateAccess.class) {
                    Download existing=OfflineStore.getDownload(c,id);
                    try {OfflineStore.change(c,id,data->{
                        if(job!=null&&!job.equals(data.optString("exportJob")))return;
                        data.put("exportError",failure);data.put("exportStatus","failed");
                        if("folder".equals(data.optString("storageMode"))) {
                            if(existing==null)data.put("cleanupStatus","complete");
                            else {
                                if(existing.state==Download.STATE_COMPLETED&&!data.optBoolean("cleanupStarted",false))data.put("storageMode","private");
                                data.put("cleanupStatus","retained");data.put("cleanupMessage","The newer folder copy failed; the earlier saved file remains available.");
                            }
                        }
                    });}catch(Exception ignored){}
                }
            }
            return Result.success();
        } finally {
            if(!finished&&transformer!=null)main.post(()->{if(transformer!=null)transformer.cancel();});
            if(temp!=null)temp.delete();if(acquired)EXPORT_SLOT.release();
        }
    }
    @Override public void onStopped(){
        super.onStopped();
        main.post(()->{if(transformer!=null)transformer.cancel();});
    }
    private void ensureActive(Context c,String id) throws IOException {
        if(isStopped()||Thread.currentThread().isInterrupted())throw new IOException("Export was interrupted.");
        JSONObject data=OfflineStore.get(c,id);
        if(data==null)throw new IOException("The download was removed.");
        if(job!=null&&!job.equals(data.optString("exportJob")))throw new IOException("A newer copy replaced this request.");
    }
    private ExportResult makeMp4(Context c,DownloadRequest request,File target,String id) throws Exception {
        MediaItem media=request.toMediaItem();
        CountDownLatch done=new CountDownLatch(1);
        AtomicReference<ExportResult> result=new AtomicReference<>();AtomicReference<Exception> failure=new AtomicReference<>();
        main.post(()->{
            try {
                if(isStopped()){done.countDown();return;}
                CacheDataSource.Factory cache=OfflineStore.cacheOnly(c,request);
                DefaultMediaSourceFactory source=new DefaultMediaSourceFactory(cache);
                ExoPlayerAssetLoader.Factory loader=new ExoPlayerAssetLoader.Factory(c,new DefaultDecoderFactory.Builder(c).build(),Clock.DEFAULT,source);
                // Some HLS streams advertise a virtually square SAR (e.g. 1280:1281).
                // Treat that tiny difference as square to avoid needless re-encoding.
                AssetLoader.Factory passthrough=(edited,looper,listener,settings)->loader.createAssetLoader(edited,looper,new AssetLoader.Listener(){
                    @Override public void onDurationUs(long duration){listener.onDurationUs(duration);}
                    @Override public void onTrackCount(int count){listener.onTrackCount(count);}
                    @Override public boolean onTrackAdded(Format original,int types){
                        float ratio=original.pixelWidthHeightRatio;Format normalized=original;
                        if(MimeTypes.isVideo(original.sampleMimeType)&&ratio>0.995f&&ratio<1.005f)
                            normalized=original.buildUpon().setPixelWidthHeightRatio(1f).build();
                        return listener.onTrackAdded(normalized,types);
                    }
                    @Override public SampleConsumer onOutputFormat(Format f)throws ExportException{return listener.onOutputFormat(f);}
                    @Override public void onError(ExportException e){listener.onError(e);}
                },settings);
                transformer=new Transformer.Builder(c).setAssetLoaderFactory(passthrough)
                    .setMuxerFactory(new InAppMuxer.Factory.Builder().build())
                    .addListener(new Transformer.Listener(){
                        @Override public void onCompleted(Composition composition,ExportResult r){result.set(r);transformer=null;done.countDown();}
                        @Override public void onError(Composition composition,ExportResult r,ExportException e){failure.set(e);transformer=null;done.countDown();}
                    }).build();
                transformer.start(media,target.getAbsolutePath());
            }catch(Exception e){failure.set(e);transformer=null;done.countDown();}
        });
        long deadline=System.currentTimeMillis()+TimeUnit.HOURS.toMillis(3);
        while(!done.await(1,TimeUnit.SECONDS)) {
            if(isStopped()||OfflineStore.get(c,id)==null||System.currentTimeMillis()>deadline) {
                CountDownLatch canceled=new CountDownLatch(1);
                main.post(()->{try{if(transformer!=null)transformer.cancel();transformer=null;}finally{canceled.countDown();}});
                canceled.await(10,TimeUnit.SECONDS);
                throw new IOException("Export was interrupted or took too long. Try again.");
            }
        }
        ensureActive(c,id);
        if(failure.get()!=null)throw new IOException("Could not convert this cached stream for the folder. Device or format may be unsupported.",failure.get());
        if(result.get()==null)throw new IOException("The export did not finish. Try again.");
        return result.get();
    }
    private static void validateTracks(File file) throws Exception {
        MediaExtractor extractor=new MediaExtractor();boolean video=false,audio=false;
        try {
            extractor.setDataSource(file.getAbsolutePath());
            for(int i=0;i<extractor.getTrackCount();i++) {
                MediaFormat format=extractor.getTrackFormat(i);String mime=format.getString(MediaFormat.KEY_MIME);
                if(mime!=null&&mime.startsWith("video/"))video=true;
                if(mime!=null&&mime.startsWith("audio/"))audio=true;
            }
        } finally {extractor.release();}
        if(!video||!audio)throw new IOException("The exported file is missing a readable video or audio track.");
    }
    private static Uri create(Context c,Uri root,String mime,String name,List<Uri> created) throws Exception {
        Uri result=DocumentsContract.createDocument(c.getContentResolver(),root,mime,name);
        if(result==null)throw new IOException("The selected folder could not create a file.");
        created.add(result);
        // Sidecar auto-loading relies on matching names; a silently renamed file is not safe.
        try(Cursor q=c.getContentResolver().query(result,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
            if(q==null||!q.moveToFirst()||!name.equals(q.getString(0)))throw new IOException("The storage provider changed the saved file name. Try another folder.");
        }
        return result;
    }
    private JSONArray writeSubtitles(Context c,String id,JSONObject meta,Uri root,String basename,List<Uri> created,boolean fromFolder)throws Exception {
        JSONArray tracks=meta.optJSONArray(fromFolder?"exportTracks":"tracks");JSONArray saved=new JSONArray();
        if(tracks==null) {
            if(fromFolder&&meta.optInt("exportSubtitleCount",0)>0)throw new IOException("The existing subtitle files are unavailable. The original was kept.");
            return saved;
        }
        JSONObject item=meta.optJSONObject("item");String source=item==null?"":item.optString("source");
        List<JSONObject> list=new ArrayList<>();
        for(int i=0;i<tracks.length();i++){JSONObject t=tracks.optJSONObject(i);if(t!=null&&SubtitlePolicy.keepTrack(source,t.optString("language"),t.optString("label")))list.add(t);}
        String preferred="indonesian".equals(SubtitlePolicy.languageFor(source,meta.optString("language")))?"id":"en";
        Collections.sort(list,(a,b)->Boolean.compare(!preferred.equals(a.optString("language")),!preferred.equals(b.optString("language"))));
        int written=0;
        for(JSONObject t:list) {
            String mime=t.optString("mime","text/vtt"),ext="application/x-subrip".equals(mime)?"srt":"vtt";
            InputStream in;
            if(fromFolder) {
                String raw=t.optString("uri");if(!raw.startsWith("content://"))throw new IOException("A saved subtitle is unavailable. The original was kept.");
                in=c.getContentResolver().openInputStream(Uri.parse(raw));
            } else {
                String name=t.optString("file");
                if(!name.matches("track-[0-9]+\\.(vtt|srt)"))throw new IOException("A saved subtitle has an unsupported filename.");
                File input=new File(OfflineStore.subtitleDir(c,id),name);
                if(!input.isFile()||input.length()==0)throw new IOException("A saved subtitle is missing. Retry the download.");
                ext=name.substring(name.lastIndexOf('.')+1);in=new FileInputStream(input);
            }
            String lang=t.optString("language","und").replaceAll("[^A-Za-z0-9-]","");if(lang.isEmpty())lang="und";
            String output=basename+(written==0?"":"."+lang+"-"+written)+"."+ext;
            Uri dest=create(c,root,"srt".equals(ext)?"application/x-subrip":"text/vtt",output,created);
            JSONObject info=FolderIntegrity.copy(c,in,dest,()->ensureActive(c,id));
            info.put("mime","srt".equals(ext)?"application/x-subrip":"text/vtt").put("language",lang)
                .put("label",t.optString("label","Subtitles")).put("preferred",t.optBoolean("preferred",written==0));
            saved.put(info);written++;
        }
        return saved;
    }
    private static String fileBase(JSONObject meta,String id) {
        JSONObject item=meta.optJSONObject("item"),episode=meta.optJSONObject("episode");
        String title=item==null?"Episode":item.optString("title","Episode");
        String number=episode==null?"":episode.optString("number");
        String text=(title+(number.isEmpty()?"":" - Episode "+number)).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]"," ").replaceAll("\\s+"," ").trim();
        if(text.isEmpty())text="Episode";if(text.length()>90)text=text.substring(0,90).trim();
        return text+" - "+id.substring(0,6)+"-"+UUID.randomUUID().toString().substring(0,8).toLowerCase(Locale.ROOT);
    }
    private static boolean deleteCreated(Context c,List<Uri> files) {
        boolean clean=true;
        for(int i=files.size()-1;i>=0;i--)try{if(!DocumentsContract.deleteDocument(c.getContentResolver(),files.get(i)))clean=false;}
        catch(Exception e){clean=false;}
        return clean;
    }
    private ForegroundInfo foregroundInfo(JSONObject meta,String id) {
        Context c=getApplicationContext();String channel=MokuDownloadService.CHANNEL;
        if(Build.VERSION.SDK_INT>=26) {
            NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(channel,"Episode downloads",NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent open=PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        JSONObject item=meta.optJSONObject("item");String title=item==null?"Episode":item.optString("title","Episode");
        Notification n=new NotificationCompat.Builder(c,channel).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Saving playable copy").setContentText(title).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).build();
        int notificationId=22000+(id.hashCode()&0x3fff);
        if(Build.VERSION.SDK_INT>=29)return new ForegroundInfo(notificationId,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        return new ForegroundInfo(notificationId,n);
    }
}
