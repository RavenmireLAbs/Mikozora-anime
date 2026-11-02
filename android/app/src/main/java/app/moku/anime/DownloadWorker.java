package app.moku.anime;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
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
    static final String EXTRA_OPEN_DOWNLOADS="open_downloads";
    private static final String READY_CHANNEL="moku_downloads_ready";
    private static final int SMART_METERED_STOP_REASON=731;
    public DownloadWorker(@NonNull Context context,@NonNull WorkerParameters params) { super(context,params); }
    @Override public void onStopped() {
        try {
            Context c=getApplicationContext();String id=getInputData().getString("id");
            if(id!=null&&id.matches("[a-f0-9]{32}")) {
                JSONObject meta=OfflineStore.get(c,id);
                Download download=OfflineStore.getDownload(c,id);
                if(smartWifiOnly(meta)&&(download==null||(download.state!=Download.STATE_COMPLETED&&download.state!=Download.STATE_FAILED&&download.state!=Download.STATE_REMOVING)))OfflineStore.manager(c).setStopReason(id,SMART_METERED_STOP_REASON);
            }
        }catch(Exception ignored){}
        super.onStopped();
    }
    @NonNull @Override public Result doWork() {
        Context c=getApplicationContext();String id=getInputData().getString("id");
        if(id==null || !id.matches("[a-f0-9]{32}"))return Result.failure();
        JSONObject meta=OfflineStore.get(c,id);if(meta==null)return Result.success();
        if("folder".equals(meta.optString("storageMode"))&&meta.optBoolean("exportVerified",false))return Result.success();
        try {
            setForegroundAsync(foregroundInfo(meta,id)).get();
            Download prior=OfflineStore.getDownload(c,id);
            if(prior!=null && prior.state==Download.STATE_COMPLETED) {
                OfflineStore.update(c,id,"status","completed");ExportStore.maybeAutoExport(c,id);notifyReady(c,id);return Result.success();
            }
            if(prior!=null && prior.state!=Download.STATE_FAILED && prior.state!=Download.STATE_REMOVING) {
                applySmartNetworkGate(c,id,meta);
                DownloadService.sendResumeDownloads(c,MokuDownloadService.class,true);
                return waitForDownload(c,id,false);
            }
            OfflineStore.update(c,id,"status","resolving");
            OfflineStore.update(c,id,"error","");
            meta=OfflineStore.get(c,id);if(meta==null || isStopped())return Result.success();
            if(smartWifiOnly(meta)&&!isUnmetered(c)){OfflineStore.update(c,id,"status","queued");return Result.retry();}
            String server=meta.optString("serverChoice","auto"),quality=meta.optString("qualityChoice","best");
            JSONObject item=meta.getJSONObject("item");String source=item.optString("source");
            String language=SubtitlePolicy.languageFor(source,meta.optString("language","english"));
            boolean englishOnly=SubtitlePolicy.englishOnly(source);
            SubtitlePolicy.Selection subtitleSelection=SubtitlePolicy.selectionFromRecord(meta);
            VideoResolver.Result resolved=VideoResolver.resolve(item,meta.getJSONObject("episode"),language,server,quality);
            if(isStopped()||OfflineStore.get(c,id)==null)return Result.success();
            SafeHttp.publicUrl(resolved.url);
            OfflineStore.registerReferer(c,resolved.url,resolved.referer);
            // The selection is checked before making any subtitle-file network request.
            JSONArray savedTracks=saveTracks(c,id,resolved,source,subtitleSelection);
            if(subtitleSelection.auto()&&!englishOnly&&!resolved.tracks.isEmpty()&&savedTracks.length()==0)
                throw new IOException("The host provided subtitles, but none could be saved. Please retry.");
            String preferred="indonesian".equals(language)?"id":"en";
            boolean offered=false,savedPreferred=false,selectedOffered=false;
            for(VideoResolver.Track t:resolved.tracks) {
                if(preferred.equals(t.language)||("en".equals(preferred)&&SubtitlePolicy.isEnglish(t.language,t.label)))offered=true;
                if(SubtitlePolicy.matchesSelection(subtitleSelection,t.language,t.label))selectedOffered=true;
            }
            for(int i=0;i<savedTracks.length();i++) {
                JSONObject t=savedTracks.getJSONObject(i);
                if(preferred.equals(t.optString("language"))||("en".equals(preferred)&&SubtitlePolicy.isEnglish(t.optString("language"),t.optString("label"))))savedPreferred=true;
            }
            if(subtitleSelection.auto()&&offered&&!savedPreferred)throw new IOException("The requested subtitle track could not be saved. Please retry.");
            meta=OfflineStore.get(c,id);if(meta==null || isStopped())return Result.success();
            String description=subtitleSelection.none()
                ?(resolved.subtitleDescription!=null&&resolved.subtitleDescription.contains("burned in")?resolved.subtitleDescription:"No separate subtitles selected")
                :(englishOnly&&subtitleSelection.auto()?"No English subtitles available":resolved.subtitleDescription);
            if(savedTracks.length()>0) {
                StringBuilder names=new StringBuilder();
                for(int i=0;i<Math.min(savedTracks.length(),3);i++){if(i>0)names.append(", ");names.append(savedTracks.getJSONObject(i).optString("label"));}
                description=names+(savedTracks.length()>3?" + "+(savedTracks.length()-3)+" more":"")+" subtitles saved";
                if(subtitleSelection.auto()&&!offered)description="Requested language unavailable · "+description;
            }
            final String summary=description;
            if(!OfflineStore.change(c,id,current->{current.put("language",language);current.put("tracks",savedTracks);current.put("host",resolved.host);current.put("serverLabel",resolved.serverLabel);current.put("subtitleDescription",summary);}))return Result.success();
            meta=OfflineStore.get(c,id);if(meta==null || isStopped())return Result.success();
            if(smartWifiOnly(meta)&&!isUnmetered(c)){OfflineStore.update(c,id,"status","queued");return Result.retry();}
            Prepared prepared=prepare(c,id,resolved,language,quality,englishOnly,subtitleSelection);
            if(isStopped()||OfflineStore.get(c,id)==null)return Result.success();
            if(subtitleSelection.custom()&&savedTracks.length()==0&&!prepared.subtitleSelected)
                throw new IOException(selectedOffered||prepared.subtitleOffered
                    ?"The selected subtitle track could not be saved. Please retry."
                    :"The selected subtitle track is not available for this episode.");
            if(savedTracks.length()==0&&prepared.subtitleSelected&&((englishOnly&&subtitleSelection.auto())||subtitleSelection.custom())) {
                String hlsDescription="English subtitles saved with video";
                if(subtitleSelection.custom()&&!prepared.subtitleLabels.isEmpty()) {
                    StringBuilder names=new StringBuilder();
                    for(int i=0;i<Math.min(prepared.subtitleLabels.size(),3);i++){if(i>0)names.append(", ");names.append(prepared.subtitleLabels.get(i));}
                    hlsDescription=names+(prepared.subtitleLabels.size()>3?" + "+(prepared.subtitleLabels.size()-3)+" more":"")+" subtitles saved with video";
                }
                OfflineStore.update(c,id,"subtitleDescription",hlsDescription);
            }
            OfflineStore.update(c,id,"qualityLabel",prepared.qualityLabel);
            meta=OfflineStore.get(c,id);if(meta==null || isStopped())return Result.success();
            if(smartWifiOnly(meta)&&!isUnmetered(c)){OfflineStore.update(c,id,"status","queued");return Result.retry();}
            DownloadService.sendAddDownload(c,MokuDownloadService.class,prepared.request,true);
            applySmartNetworkGate(c,id,meta);
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
    private static boolean smartWifiOnly(JSONObject meta) {
        return meta!=null&&meta.optBoolean("autoDownload",false)&&meta.optBoolean("smartWifiOnly",false);
    }
    private static boolean isUnmetered(Context c) {
        try {
            ConnectivityManager manager=(ConnectivityManager)c.getSystemService(Context.CONNECTIVITY_SERVICE);
            if(manager==null)return false;
            Network network=manager.getActiveNetwork();if(network==null)return false;
            NetworkCapabilities capabilities=manager.getNetworkCapabilities(network);
            return capabilities!=null&&capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
        }catch(Exception ignored){return false;}
    }
    private static boolean applySmartNetworkGate(Context c,String id,JSONObject meta) {
        if(!smartWifiOnly(meta))return true;
        boolean unmetered=isUnmetered(c);
        try {
            Download download=OfflineStore.getDownload(c,id);
            if(download==null||(download.state!=Download.STATE_COMPLETED&&download.state!=Download.STATE_FAILED&&download.state!=Download.STATE_REMOVING))
                OfflineStore.manager(c).setStopReason(id,unmetered?Download.STOP_REASON_NONE:SMART_METERED_STOP_REASON);
        }catch(Exception ignored){}
        return unmetered;
    }
    static void notifyReady(Context c,String id) {
        try {
            JSONObject meta=OfflineStore.claimReadyNotification(c,id);if(meta==null)return;
            if(Build.VERSION.SDK_INT>=33&&ContextCompat.checkSelfPermission(c,Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;
            if(!NotificationManagerCompat.from(c).areNotificationsEnabled())return;
            if(Build.VERSION.SDK_INT>=26) {
                NotificationManager manager=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
                if(manager!=null)manager.createNotificationChannel(new NotificationChannel(READY_CHANNEL,"Downloads ready",NotificationManager.IMPORTANCE_DEFAULT));
            }
            JSONObject item=meta.optJSONObject("item"),episode=meta.optJSONObject("episode");
            String series=item==null?"Your series":item.optString("title","Your series");
            String number=episode==null?"":episode.optString("number");
            String episodeText=number.isEmpty()?(episode==null?"New episode":episode.optString("title","New episode")):"Episode "+number;
            Intent intent=new Intent(c,MainActivity.class).putExtra(EXTRA_OPEN_DOWNLOADS,true)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int notificationId=12000+(id.hashCode()&0x3fff);
            PendingIntent open=PendingIntent.getActivity(c,notificationId,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
            Notification notification=new NotificationCompat.Builder(c,READY_CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Ready to watch offline")
                .setContentText(series+" · "+episodeText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(series+" · "+episodeText))
                .setContentIntent(open).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_STATUS)
                .setColor(0xffbfe88d).build();
            NotificationManagerCompat.from(c).notify(notificationId,notification);
        }catch(Exception ignored){ /* A ready alert must never change a completed download. */ }
    }
    private Result waitForDownload(Context c,String id,boolean justSubmitted) throws Exception {
        // A previous FAILED record can remain visible briefly while Media3 processes a retry.
        long staleFailureDeadline=justSubmitted?System.currentTimeMillis()+12000:0;
        // The resolver worker occupies one of two slots until its media download ends, so expiring
        // host URLs aren't generated for a long queue. Media3 itself persists and resumes the transfer.
        while(!isStopped() && OfflineStore.get(c,id)!=null) {
            JSONObject current=OfflineStore.get(c,id);
            if(current!=null&&"folder".equals(current.optString("storageMode"))&&current.optBoolean("exportVerified",false))return Result.success();
            applySmartNetworkGate(c,id,current);
            Download d=OfflineStore.getDownload(c,id);
            if(d!=null && d.state==Download.STATE_COMPLETED) { OfflineStore.update(c,id,"status","completed");ExportStore.maybeAutoExport(c,id);notifyReady(c,id);return Result.success(); }
            if(d!=null && d.state==Download.STATE_FAILED && System.currentTimeMillis()>=staleFailureDeadline) {
                OfflineStore.update(c,id,"status","failed");
                OfflineStore.update(c,id,"error","The host or network interrupted the download. Try again.");
                return Result.success();
            }
            try { Thread.sleep(1500); } catch(InterruptedException e) { Thread.currentThread().interrupt();return Result.retry(); }
        }
        return Result.success();
    }
    private JSONArray saveTracks(Context c,String id,VideoResolver.Result resolved,String source,SubtitlePolicy.Selection selection) throws Exception {
        File dir=OfflineStore.subtitleDir(c,id);OfflineStore.deleteTree(dir);
        if(!dir.mkdirs()&&!dir.isDirectory())throw new IOException("Could not create subtitle storage");
        JSONArray saved=new JSONArray();
        for(VideoResolver.Track track:VideoResolver.subtitleTracksForDownload(resolved,source,selection)) {
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
        if(selection.custom()) {
            for(int i=0;i<saved.length();i++)saved.getJSONObject(i).put("preferred",false);
            boolean marked=false;
            for(int i=0;i<selection.tracks.length()&&!marked;i++) {
                String wanted=selection.tracks.getJSONObject(i).optString("id");
                for(int j=0;j<saved.length();j++) {
                    JSONObject track=saved.getJSONObject(j);
                    if(wanted.equals(SubtitlePolicy.trackId(track.optString("language"),track.optString("label")))) {
                        track.put("preferred",true);marked=true;break;
                    }
                }
            }
        }
        return saved;
    }
    static final class Prepared {
        final DownloadRequest request;
        final String qualityLabel;
        final boolean subtitleSelected;
        final boolean subtitleOffered;
        final List<String> subtitleLabels;
        Prepared(DownloadRequest request,String qualityLabel,boolean subtitleSelected,boolean subtitleOffered,List<String> subtitleLabels){
            this.request=request;this.qualityLabel=qualityLabel;this.subtitleSelected=subtitleSelected;
            this.subtitleOffered=subtitleOffered;this.subtitleLabels=subtitleLabels;
        }
    }
    private static final class TextSelection {
        boolean selected;
        boolean offered;
        final List<String> labels=new ArrayList<>();
    }
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality) throws Exception {
        return prepare(c,id,media,language,quality,false,OfflineStore.upstream(c));
    }
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality,boolean englishOnly) throws Exception {
        return prepare(c,id,media,language,quality,englishOnly,OfflineStore.upstream(c));
    }
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality,boolean englishOnly,SubtitlePolicy.Selection selection) throws Exception {
        return prepare(c,id,media,language,quality,englishOnly,selection,OfflineStore.upstream(c));
    }
    // The explicit factory overload also permits deterministic offline fixture tests.
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality,boolean englishOnly,DataSource.Factory upstream) throws Exception {
        return prepare(c,id,media,language,quality,englishOnly,SubtitlePolicy.autoSelection(),upstream);
    }
    static Prepared prepare(Context c,String id,VideoResolver.Result media,String language,String quality,boolean englishOnly,SubtitlePolicy.Selection rawSelection,DataSource.Factory upstream) throws Exception {
        final SubtitlePolicy.Selection selection=rawSelection==null?SubtitlePolicy.autoSelection():rawSelection;
        MediaItem.Builder builder=new MediaItem.Builder().setUri(media.url).setMediaId(id);
        if(media.mime!=null&&!media.mime.isEmpty())builder.setMimeType(media.mime);
        else if(media.url.toLowerCase().contains(".mp4"))builder.setMimeType(MimeTypes.VIDEO_MP4);
        MediaItem item=builder.build();
        String preferredText=selection.custom()&&!selection.preferredLanguage.isEmpty()&&!"und".equals(selection.preferredLanguage)
            ?selection.preferredLanguage:("indonesian".equals(language)?"id":"en");
        TrackSelectionParameters.Builder selections=DownloadHelper.getDefaultTrackSelectorParameters(c).buildUpon()
            .setMaxVideoSize(1920,1080).setForceHighestSupportedBitrate(true)
            .setPreferredTextLanguage(preferredText);
        // Don't let Media3's default/forced subtitle fallback select an unchosen language.
        if(selection.none()||selection.custom()||(selection.auto()&&englishOnly))selections.setTrackTypeDisabled(C.TRACK_TYPE_TEXT,true);
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
                            TextSelection textSelection=new TextSelection();
                            if(h.getPeriodCount()>0) {
                                if(selection.custom())textSelection=addSelectedHlsText(h,params,
                                    (trackLanguage,trackLabel)->SubtitlePolicy.matchesSelection(selection,trackLanguage,trackLabel),
                                    "Could not restrict subtitles to the selected tracks.");
                                else if(selection.auto()&&englishOnly)textSelection=addSelectedHlsText(h,params,
                                    SubtitlePolicy::isEnglish,"Could not restrict subtitles to English.");
                                else if(selection.auto())h.addTextLanguagesToSelection(false,"en","id");
                            }
                            result.set(new Prepared(h.getDownloadRequest(id,CacheScopes.marker()),label,
                                textSelection.selected,textSelection.offered,textSelection.labels));
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
    private interface TextMatcher { boolean matches(String language,String label); }
    /** Add only explicitly matching HLS text tracks; never a default-language fallback. */
    private static TextSelection addSelectedHlsText(DownloadHelper helper,TrackSelectionParameters defaults,TextMatcher matcher,String errorMessage) throws IOException {
        TextSelection result=new TextSelection();
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
                        if(mapped.getTrackSupport(renderer,g,t)!=C.FORMAT_HANDLED||!matcher.matches(format.language,format.label))continue;
                        result.offered=true;
                        helper.addTrackSelection(period,textOnly.setOverrideForType(new TrackSelectionOverride(group,t)).build());
                    }
                }
            }
            // Guard against unexpected selector fallback: never enqueue an unchosen text rendition.
            for(int renderer=0;renderer<mapped.getRendererCount();renderer++) {
                if(mapped.getRendererType(renderer)!=C.TRACK_TYPE_TEXT)continue;
                for(ExoTrackSelection track:helper.getTrackSelections(period,renderer))for(int t=0;t<track.length();t++) {
                    Format format=track.getFormat(t);
                    if(!matcher.matches(format.language,format.label))throw new IOException(errorMessage);
                    result.selected=true;
                    String label=format.label==null||format.label.trim().isEmpty()
                        ?SubtitlePolicy.languageCode(format.language,""):format.label;
                    if(!result.labels.contains(label))result.labels.add(label);
                }
            }
        }
        return result;
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
