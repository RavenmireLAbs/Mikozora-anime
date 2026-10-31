package app.moku.anime;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.core.app.NotificationCompat;
import androidx.media3.common.MediaItem;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadHelper;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.media3.exoplayer.source.TrackGroupArray;
import androidx.media3.exoplayer.trackselection.ExoTrackSelection;
import androidx.media3.exoplayer.trackselection.MappingTrackSelector.MappedTrackInfo;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@OptIn(markerClass = UnstableApi.class)
public final class DownloadWorker extends Worker {
    public DownloadWorker(@NonNull Context context,@NonNull WorkerParameters params) { super(context,params); }
    @NonNull @Override public Result doWork() {
        Context c=getApplicationContext();String id=getInputData().getString("id");
        if(id==null || !id.matches("[a-f0-9]{32}"))return Result.failure();
        JSONObject meta=OfflineStore.get(c,id);if(meta==null)return Result.success();
        if("folder".equals(meta.optString("storageMode"))&&meta.optBoolean("exportVerified",false))return Result.success();
        try {
            setForegroundAsync(foregroundInfo(meta,id)).get();
            Download prior=OfflineStore.getDownload(c,id);
            if(prior!=null && prior.state==Download.STATE_COMPLETED) {
                OfflineStore.update(c,id,"status","completed");ExportStore.maybeAutoExport(c,id);return Result.success();
            }
            if(prior!=null && prior.state!=Download.STATE_FAILED && prior.state!=Download.STATE_REMOVING) {
                DownloadService.sendResumeDownloads(c,MokuDownloadService.class,true);
                return waitForDownload(c,id,false);
            }
            OfflineStore.update(c,id,"status","resolving");
            OfflineStore.update(c,id,"error","");
            meta=OfflineStore.get(c,id);if(meta==null || isStopped())return Result.success();
            String server=meta.optString("serverChoice","auto"),quality=meta.optString("qualityChoice","best");
            JSONObject item=meta.getJSONObject("item");String source=item.optString("source");
            String language=SubtitlePolicy.languageFor(source,meta.optString("language","english"));
            boolean englishOnly=SubtitlePolicy.englishOnly(source);
            VideoResolver.Result resolved=VideoResolver.resolve(item,meta.getJSONObject("episode"),language,server,quality);
            if(isStopped()||OfflineStore.get(c,id)==null)return Result.success();
            SafeHttp.publicUrl(resolved.url);
            OfflineStore.registerReferer(c,resolved.url,resolved.referer);
            // The language policy is checked before making any subtitle-file network request.
            JSONArray savedTracks=saveTracks(c,id,resolved,source);
            if(!englishOnly&&!resolved.tracks.isEmpty()&&savedTracks.length()==0)
                throw new IOException("The host provided subtitles, but none could be saved. Please retry.");
            String preferred="indonesian".equals(language)?"id":"en";
            boolean offered=false,savedPreferred=false;
            for(VideoResolver.Track t:resolved.tracks)
                if(preferred.equals(t.language)||("en".equals(preferred)&&SubtitlePolicy.isEnglish(t.language,t.label)))offered=true;
            for(int i=0;i<savedTracks.length();i++) {
                JSONObject t=savedTracks.getJSONObject(i);
                if(preferred.equals(t.optString("language"))||("en".equals(preferred)&&SubtitlePolicy.isEnglish(t.optString("language"),t.optString("label"))))savedPreferred=true;
            }
            if(offered&&!savedPreferred)throw new IOException("The requested subtitle track could not be saved. Please retry.");
            meta=OfflineStore.get(c,id);if(meta==null || isStopped())return Result.success();
            String description=englishOnly?"No English subtitles available":resolved.subtitleDescription;
            if(savedTracks.length()>0) {
                StringBuilder names=new StringBuilder();
                for(int i=0;i<Math.min(savedTracks.length(),3);i++){if(i>0)names.append(", ");names.append(savedTracks.getJSONObject(i).optString("label"));}
                description=names+(savedTracks.length()>3?" + "+(savedTracks.length()-3)+" more":"")+" subtitles saved";
                if(!offered)description="Requested language unavailable · "+description;
            }
            final String summary=description;
            if(!OfflineStore.change(c,id,current->{current.put("language",language);current.put("tracks",savedTracks);current.put("host",resolved.host);current.put("serverLabel",resolved.serverLabel);current.put("subtitleDescription",summary);}))return Result.success();
            Prepared prepared=prepare(c,id,resolved,language,quality,englishOnly);
            if(isStopped()||OfflineStore.get(c,id)==null)return Result.success();
            if(englishOnly&&savedTracks.length()==0&&prepared.englishHlsText)
                OfflineStore.update(c,id,"subtitleDescription","English subtitles saved with video");
            OfflineStore.update(c,id,"qualityLabel",prepared.qualityLabel);
            DownloadService.sendAddDownload(c,MokuDownloadService.class,prepared.request,true);
            if(OfflineStore.get(c,id)==null) {
                DownloadService.sendRemoveDownload(c,MokuDownloadService.class,id,true);
                return Result.success();
            }
            OfflineStore.update(c,id,"status","queued");
            return waitForDownload(c,id,true);
        } catch(Exception e) {
            if(!isStopped() && OfflineStore.get(c,id)!=null) {
                OfflineStore.update(c,id,"error",safeError(e));OfflineStore.update(c,id,"status","failed");
            }
            // Individual failures must not cancel other episodes in the batch.
            return Result.success();
        }
    }
    private Result waitForDownload(Context c,String id,boolean justSubmitted) throws Exception {
        // A previous FAILED record can remain visible briefly while Media3 processes a retry.
        long staleFailureDeadline=justSubmitted?System.currentTimeMillis()+12000:0;
        // The resolver worker occupies one of two slots until its media download ends, so expiring
        // host URLs aren't generated for a long queue. Media3 itself persists and resumes the transfer.
        while(!isStopped() && OfflineStore.get(c,id)!=null) {
            JSONObject current=OfflineStore.get(c,id);
            if(current!=null&&"folder".equals(current.optString("storageMode"))&&current.optBoolean("exportVerified",false))return Result.success();
            Download d=OfflineStore.getDownload(c,id);
            if(d!=null && d.state==Download.STATE_COMPLETED) { OfflineStore.update(c,id,"status","completed");ExportStore.maybeAutoExport(c,id);return Result.success(); }
            if(d!=null && d.state==Download.STATE_FAILED && System.currentTimeMillis()>=staleFailureDeadline) {
                OfflineStore.update(c,id,"status","failed");
                OfflineStore.update(c,id,"error","The host or network interrupted the download. Try again.");
                return Result.success();
            }
            try { Thread.sleep(1500); } catch(InterruptedException e) { Thread.currentThread().interrupt();return Result.retry(); }
        }
        return Result.success();
    }
    private JSONArray saveTracks(Context c,String id,VideoResolver.Result resolved,String source) throws Exception {
        File dir=OfflineStore.subtitleDir(c,id);OfflineStore.deleteTree(dir);
        if(!dir.mkdirs()&&!dir.isDirectory())throw new IOException("Could not create subtitle storage");
        JSONArray saved=new JSONArray();
        for(VideoResolver.Track track:VideoResolver.subtitleTracksForDownload(resolved,source)) {
            if(isStopped()||OfflineStore.get(c,id)==null)break;
            try {
                byte[] bytes=SafeHttp.get(track.url,resolved.referer,2*1024*1024);
                String text=new String(bytes,StandardCharsets.UTF_8);
                if(!text.contains("-->"))continue; // Avoid saving an HTML error page as a subtitle.
                String name="track-"+saved.length()+("application/x-subrip".equals(track.mime)?".srt":".vtt");
                File target=new File(dir,name),temp=new File(dir,name+".tmp");
                try(FileOutputStream out=new FileOutputStream(temp)) { out.write(bytes);out.getFD().sync(); }
                if(!temp.renameTo(target))throw new IOException("Could not store subtitles");
                saved.put(new JSONObject().put("file",name).put("label",track.label).put("language",track.language).put("mime",track.mime).put("preferred",track.preferred));
            }catch(Exception ignored) { }
        }
        return saved;
    }
    static final class Prepared {
        final DownloadRequest request;
        final String qualityLabel;
        final boolean englishHlsText;
        Prepared(DownloadRequest request,String qualityLabel,boolean englishHlsText){this.request=request;this.qualityLabel=qualityLabel;this.englishHlsText=englishHlsText;}
    }
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality) throws Exception {
        return prepare(c,id,media,language,quality,false,OfflineStore.upstream(c));
    }
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality,boolean englishOnly) throws Exception {
        return prepare(c,id,media,language,quality,englishOnly,OfflineStore.upstream(c));
    }
    // The explicit factory overload also permits deterministic offline fixture tests.
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality,boolean englishOnly,DataSource.Factory upstream) throws Exception {
        MediaItem.Builder builder=new MediaItem.Builder().setUri(media.url).setMediaId(id);
        if(media.mime!=null&&!media.mime.isEmpty())builder.setMimeType(media.mime);
        else if(media.url.toLowerCase().contains(".mp4"))builder.setMimeType(MimeTypes.VIDEO_MP4);
        MediaItem item=builder.build();
        TrackSelectionParameters.Builder selections=DownloadHelper.getDefaultTrackSelectorParameters(c).buildUpon()
            .setMaxVideoSize(1920,1080).setForceHighestSupportedBitrate(true)
            .setPreferredTextLanguage("indonesian".equals(language)?"id":"en");
        // Don't let Media3's default/forced subtitle fallback select another language.
        if(englishOnly)selections.setTrackTypeDisabled(C.TRACK_TYPE_TEXT,true);
        TrackSelectionParameters params=selections.build();
        CountDownLatch done=new CountDownLatch(1);
        AtomicReference<Prepared> result=new AtomicReference<>();AtomicReference<Exception> error=new AtomicReference<>();
        AtomicReference<DownloadHelper> reference=new AtomicReference<>();
        new Handler(Looper.getMainLooper()).post(()->{
            try {
                DownloadHelper helper=DownloadHelper.forMediaItem(item,params,new DefaultRenderersFactory(c),upstream);
                reference.set(helper);
                helper.prepare(new DownloadHelper.Callback(){
                    @Override public void onPrepared(DownloadHelper h) {
                        try {
                            String label=selectVideoQuality(h,params,media,quality);
                            boolean hasEnglish=false;
                            if(h.getPeriodCount()>0) {
                                if(englishOnly)hasEnglish=addEnglishHlsText(h,params);
                                else h.addTextLanguagesToSelection(false,"en","id");
                            }
                            result.set(new Prepared(h.getDownloadRequest(id,CacheScopes.marker()),label,hasEnglish));
                        }catch(Exception e){error.set(e);}finally{h.release();done.countDown();}
                    }
                    @Override public void onPrepareError(DownloadHelper h,IOException e){error.set(e);h.release();done.countDown();}
                });
            }catch(Exception e){error.set(e);done.countDown();}
        });
        if(!done.await(90,TimeUnit.SECONDS)) {
            DownloadHelper h=reference.get();if(h!=null)new Handler(Looper.getMainLooper()).post(h::release);
            throw new IOException("The host took too long to prepare this download");
        }
        if(error.get()!=null)throw error.get();
        if(result.get()==null)throw new IOException("The host did not provide a downloadable media stream");
        return result.get();
    }
    /** Add only explicitly identified English HLS text tracks; never a default-language fallback. */
    private static boolean addEnglishHlsText(DownloadHelper helper,TrackSelectionParameters defaults) throws IOException {
        boolean selected=false;
        for(int period=0;period<helper.getPeriodCount();period++) {
            MappedTrackInfo mapped=helper.getMappedTrackInfo(period);
            TrackSelectionParameters.Builder textOnly=defaults.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT);
            for(int renderer=0;renderer<mapped.getRendererCount();renderer++) {
                int type=mapped.getRendererType(renderer);
                textOnly.setTrackTypeDisabled(type,type!=C.TRACK_TYPE_TEXT);
            }
            for(int renderer=0;renderer<mapped.getRendererCount();renderer++) {
                if(mapped.getRendererType(renderer)!=C.TRACK_TYPE_TEXT)continue;
                TrackGroupArray groups=mapped.getTrackGroups(renderer);
                for(int g=0;g<groups.length;g++) {
                    TrackGroup group=groups.get(g);
                    for(int t=0;t<group.length;t++) {
                        Format format=group.getFormat(t);
                        if(mapped.getTrackSupport(renderer,g,t)!=C.FORMAT_HANDLED||!SubtitlePolicy.isEnglish(format.language,format.label))continue;
                        helper.addTrackSelection(period,textOnly.setOverrideForType(new TrackSelectionOverride(group,t)).build());
                    }
                }
            }
            // Guard against unexpected selector fallback: never enqueue a non-English text rendition.
            for(int renderer=0;renderer<mapped.getRendererCount();renderer++) {
                if(mapped.getRendererType(renderer)!=C.TRACK_TYPE_TEXT)continue;
                for(ExoTrackSelection track:helper.getTrackSelections(period,renderer))for(int t=0;t<track.length();t++) {
                    Format format=track.getFormat(t);
                    if(!SubtitlePolicy.isEnglish(format.language,format.label))throw new IOException("Could not restrict subtitles to English.");
                    selected=true;
                }
            }
        }
        return selected;
    }
    /** Replace only the selected HLS video rendition while retaining default audio and subtitles. */
    private static String selectVideoQuality(DownloadHelper helper,TrackSelectionParameters defaults,VideoResolver.Result media,String quality) throws Exception {
        if(quality.startsWith("f:")) {
            int requested=Integer.parseInt(quality.substring(2));
            if(helper.getPeriodCount()!=0||media.fixedHeight!=requested)
                throw new IOException("The chosen file quality is unavailable for this episode");
        }
        if(helper.getPeriodCount()==0) {
            if(quality.startsWith("v:"))throw new IOException("This server does not offer selectable video renditions");
            return media.fixedHeight>0?media.fixedHeight+"p (source label)":"Source file (resolution not reported)";
        }
        int requestedW=-1,requestedH=-1;
        if(quality.startsWith("v:")) {
            String[] dims=quality.substring(2).split("x");
            if(dims.length!=2)throw new IOException("Invalid video quality");
            requestedW=Integer.parseInt(dims[0]);requestedH=Integer.parseInt(dims[1]);
        }
        String selected="";
        for(int period=0;period<helper.getPeriodCount();period++) {
            MappedTrackInfo mapped=helper.getMappedTrackInfo(period);
            if(requestedW>0) {
                TrackGroup target=null;int targetIndex=-1,bestBitrate=-1;
                for(int renderer=0;renderer<mapped.getRendererCount();renderer++) {
                    if(mapped.getRendererType(renderer)!=C.TRACK_TYPE_VIDEO)continue;
                    TrackGroupArray groups=mapped.getTrackGroups(renderer);
                    for(int g=0;g<groups.length;g++) {
                        TrackGroup group=groups.get(g);
                        for(int t=0;t<group.length;t++) {
                            Format f=group.getFormat(t);
                            if(f.width!=requestedW||f.height!=requestedH||mapped.getTrackSupport(renderer,g,t)!=C.FORMAT_HANDLED)continue;
                            if(target==null||f.bitrate>bestBitrate){target=group;targetIndex=t;bestBitrate=f.bitrate;}
                        }
                    }
                }
                if(target==null)throw new IOException("The selected video quality is unavailable or not supported on this device");
                TrackSelectionParameters chosen=defaults.buildUpon().setMaxVideoSize(Integer.MAX_VALUE,Integer.MAX_VALUE)
                    .setOverrideForType(new TrackSelectionOverride(target,targetIndex)).build();
                helper.replaceTrackSelections(period,chosen);
            }
            boolean matched=requestedW<0;
            for(int renderer=0;renderer<mapped.getRendererCount();renderer++) {
                if(mapped.getRendererType(renderer)!=C.TRACK_TYPE_VIDEO)continue;
                for(ExoTrackSelection selection:helper.getTrackSelections(period,renderer)) {
                    Format f=selection.getSelectedFormat();
                    if(f.width>0&&f.height>0)selected=f.width+" x "+f.height;
                    if(f.width==requestedW&&f.height==requestedH)matched=true;
                }
            }
            if(!matched)throw new IOException("Could not select the requested video quality");
        }
        return selected.isEmpty()?"Source quality (resolution not reported)":selected;
    }
    private ForegroundInfo foregroundInfo(JSONObject meta,String id) {
        Context c=getApplicationContext();String channel=MokuDownloadService.CHANNEL;
        if(Build.VERSION.SDK_INT>=26) {
            NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.createNotificationChannel(new NotificationChannel(channel,"Episode downloads",NotificationManager.IMPORTANCE_LOW));
        }
        PendingIntent open=PendingIntent.getActivity(c,0,new Intent(c,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        String title=meta.optJSONObject("item")!=null?meta.optJSONObject("item").optString("title","Episode"):"Episode";
        Notification n=new NotificationCompat.Builder(c,channel).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Preparing offline episode").setContentText(title).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).build();
        int notificationId=2000+(id.hashCode()&0x3fff);
        if(Build.VERSION.SDK_INT>=29)return new ForegroundInfo(notificationId,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        return new ForegroundInfo(notificationId,n);
    }
    private static String safeError(Throwable error) {
        Throwable e=error;while(e.getCause()!=null&&e.getCause()!=e)e=e.getCause();
        String text=e.getMessage();if(text==null||text.isEmpty())return "Could not prepare this download. Try again.";
        text=text.replaceAll("https?://\\S+","[host]");return text.length()>200?text.substring(0,200):text;
    }
}
