package app.moku.anime;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.concurrent.TimeUnit;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.datasource.cache.NoOpCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.offline.DownloadManager;
import androidx.media3.exoplayer.offline.DefaultDownloadIndex;
import androidx.media3.exoplayer.offline.DefaultDownloaderFactory;
import androidx.media3.exoplayer.offline.DownloadService;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;

@OptIn(markerClass = UnstableApi.class)
final class OfflineStore {
    private static final Object LOCK=new Object();
    private static SimpleCache cache;
    private static DownloadManager manager;
    private static StandaloneDatabaseProvider database;
    private static final String META="moku_offline_records", HEADERS="moku_offline_headers";
    private OfflineStore() {}
    static synchronized DownloadManager manager(Context context) {
        if(manager==null) {
            Context app=context.getApplicationContext();
            database=new StandaloneDatabaseProvider(app);
            cache=new SimpleCache(new File(app.getFilesDir(),"moku_offline_media"),new NoOpCacheEvictor(),database);
            // A distinct cache key namespace for each new request prevents removing one episode
            // from deleting segments that happen to be shared with another episode.
            java.util.concurrent.Executor downloads=Executors.newFixedThreadPool(3);
            DataSource.Factory network=upstream(app);
            manager=new DownloadManager(app,new DefaultDownloadIndex(database),request ->
                new DefaultDownloaderFactory(new CacheDataSource.Factory().setCache(cache)
                    .setCacheKeyFactory(CacheScopes.keys(request)).setUpstreamDataSourceFactory(network),downloads)
                    .createDownloader(request));
            java.util.concurrent.Executor completionEvents=Executors.newSingleThreadExecutor();
            manager.addListener(new DownloadManager.Listener() {
                @Override public void onDownloadChanged(DownloadManager downloadManager,Download download,@Nullable Exception finalException) {
                    if(download.state!=Download.STATE_COMPLETED)return;
                    String id=download.request.id;
                    // The worker normally observes completion too. This direct Media3
                    // callback is a second path if WorkManager stops or the process is
                    // restarted around the moment the transfer finishes. The persisted
                    // ready claim makes the notification exactly-once.
                    completionEvents.execute(() -> {
                        OfflineStore.update(app,id,"status","completed");
                        DownloadWorker.notifyReady(app,id);
                        BackgroundDownloads.refresh(app);
                    });
                }
            });
            manager.setMaxParallelDownloads(2);
        }
        return manager;
    }
    static synchronized SimpleCache cache(Context context) { manager(context);return cache; }
    static CacheDataSource.Factory cacheOnly(Context context,DownloadRequest request) {
        return new CacheDataSource.Factory().setCache(cache(context)).setCacheKeyFactory(CacheScopes.keys(request))
            .setUpstreamDataSourceFactory(null);
    }
    static void registerReferer(Context c,String url,String referer) {
        try { c.getSharedPreferences(HEADERS,Context.MODE_PRIVATE).edit().putString(new URL(url).getHost().toLowerCase(Locale.ROOT),referer).apply(); }
        catch(Exception ignored) { }
    }
    static DataSource.Factory upstream(Context c) {
        Context app=c.getApplicationContext();
        OkHttpClient client=new OkHttpClient.Builder().connectTimeout(20,TimeUnit.SECONDS).readTimeout(30,TimeUnit.SECONDS)
            .followRedirects(true).followSslRedirects(false)
            .dns(hostname -> {
                List<InetAddress> addresses=Dns.SYSTEM.lookup(hostname);
                try { for(InetAddress address:addresses)SafeHttp.requirePublicAddress(address); }
                catch(IOException e){UnknownHostException ex=new UnknownHostException("Private video host is not allowed");ex.initCause(e);throw ex;}
                return addresses;
            })
            .addNetworkInterceptor(chain -> {
                String raw=chain.request().url().toString();
                if(!Network.isHttps(raw))throw new IOException("Unsupported video redirect");
                String h=chain.request().url().host().toLowerCase(Locale.ROOT);
                if(h.endsWith(".internal")||h.endsWith(".home.arpa"))throw new IOException("Private video redirect");
                return chain.proceed(chain.request());
            }).build();
        OkHttpDataSource.Factory http=new OkHttpDataSource.Factory(client).setUserAgent(Network.UA);
        return new ResolvingDataSource.Factory(http, spec -> {
            if(!Network.isHttps(spec.uri.toString()))throw new IOException("Unsupported video URL");
            URL url=new URL(spec.uri.toString());
            String h=url.getHost().toLowerCase(Locale.ROOT);
            String ref=app.getSharedPreferences(HEADERS,Context.MODE_PRIVATE).getString(h,"");
            if(ref.isEmpty()) {
                if(h.equals("dailymotion.com")||h.endsWith(".dailymotion.com")||h.endsWith(".dmcdn.net"))ref="https://www.dailymotion.com/";
                else if(h.equals("mediafire.com")||h.endsWith(".mediafire.com"))ref="https://www.mediafire.com/";
                else ref="https://megaplay.buzz/";
            }
            HashMap<String,String> headers=new HashMap<>(spec.httpRequestHeaders);
            headers.put("Referer",ref);
            URL origin=new URL(ref);headers.put("Origin",origin.getProtocol()+"://"+origin.getHost());
            return spec.buildUpon().setHttpRequestHeaders(headers).build();
        });
    }
    static String idFor(String source,String episodeUrl) throws Exception {
        byte[] digest=MessageDigest.getInstance("SHA-256").digest((source+"|"+episodeUrl).getBytes(StandardCharsets.UTF_8));
        StringBuilder out=new StringBuilder();for(int i=0;i<16;i++)out.append(String.format(Locale.ROOT,"%02x",digest[i]));return out.toString();
    }
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(META,Context.MODE_PRIVATE); }
    static JSONObject get(Context c,String id) {
        synchronized(LOCK) { try { String s=prefs(c).getString(id,"");return s.isEmpty()?null:new JSONObject(s); }catch(Exception e){return null;} }
    }
    static void put(Context c,JSONObject data) {
        synchronized(LOCK) { String id=data.optString("id");if(id.matches("[a-f0-9]{32}"))prefs(c).edit().putString(id,data.toString()).commit(); }
    }
    static void update(Context c,String id,String key,Object value) {
        synchronized(LOCK) { try {JSONObject data=get(c,id);if(data==null)return;data.put(key,value);put(c,data);}catch(Exception ignored){} }
    }
    interface Mutation { void apply(JSONObject data) throws Exception; }
    /** Commit a multi-field state transition atomically; never clear private files if this fails. */
    static boolean change(Context c,String id,Mutation mutation) throws Exception {
        synchronized(LOCK) {
            JSONObject data=get(c,id);if(data==null)return false;
            mutation.apply(data);
            if(!prefs(c).edit().putString(id,data.toString()).commit())throw new IOException("Could not save download state.");
            return true;
        }
    }
    static JSONObject claimReadyNotification(Context c,String id) {
        synchronized(LOCK) {
            try {
                JSONObject meta=get(c,id);
                if(meta==null||!meta.optBoolean("autoDownload",false)||!meta.optBoolean("smartNotify",false)||meta.optLong("readyNotifiedAt",0)>0)return null;
                meta.put("readyNotifiedAt",System.currentTimeMillis());
                if(!prefs(c).edit().putString(id,meta.toString()).commit())return null;
                return new JSONObject(meta.toString());
            }catch(Exception ignored){return null;}
        }
    }
    private static long queueOrderValue(JSONObject data) {
        long value=data.optLong("queueOrder",Long.MAX_VALUE);
        return value<0?Long.MAX_VALUE:value;
    }
    private static int compareQueueRecords(JSONObject a,JSONObject b) {
        int byOrder=Long.compare(queueOrderValue(a),queueOrderValue(b));
        if(byOrder!=0)return byOrder;
        int byAdded=Long.compare(a.optLong("added"),b.optLong("added"));
        return byAdded!=0?byAdded:a.optString("id").compareTo(b.optString("id"));
    }
    private static long nextQueueOrder(Context c) {
        synchronized(LOCK) {
            long next=0;
            for(Map.Entry<String,?> e:prefs(c).getAll().entrySet())try {
                long value=new JSONObject(String.valueOf(e.getValue())).optLong("queueOrder",-1);
                if(value>=next)next=value+1;
            }catch(Exception ignored){}
            return next;
        }
    }
    static List<JSONObject> queueCandidates(Context c) {
        List<JSONObject> out=new ArrayList<>();
        synchronized(LOCK) {
            for(Map.Entry<String,?> e:prefs(c).getAll().entrySet())try {
                JSONObject meta=new JSONObject(String.valueOf(e.getValue()));
                String status=meta.optString("status");
                if(!"queued".equals(status)&&!"resolving".equals(status))continue;
                Download d=getDownload(c,meta.optString("id"));
                if(d!=null&&d.state!=Download.STATE_FAILED)continue;
                out.add(meta);
            }catch(Exception ignored){}
        }
        Collections.sort(out,OfflineStore::compareQueueRecords);
        return out;
    }
    static int activeDownloadCount(Context c) {
        int count=0;
        synchronized(LOCK) {
            for(Map.Entry<String,?> e:prefs(c).getAll().entrySet())try {
                JSONObject meta=new JSONObject(String.valueOf(e.getValue()));
                Download d=getDownload(c,meta.optString("id"));
                if(d!=null&&(d.state==Download.STATE_DOWNLOADING||d.state==Download.STATE_QUEUED||d.state==Download.STATE_RESTARTING))count++;
            }catch(Exception ignored){}
        }
        return count;
    }
    static JSONObject setQueueOrder(Context c,String payload) throws Exception {
        if(payload==null||payload.length()>20000)throw new IOException("Download queue order is too large");
        JSONArray input=new JSONArray(payload);
        if(input.length()>500)throw new IOException("Invalid download queue order");
        List<String> requested=new ArrayList<>();
        Set<String> requestedSeen=new HashSet<>();
        for(int i=0;i<input.length();i++) {
            String id=input.optString(i,"");
            if(id.matches("[a-f0-9]{32}")&&requestedSeen.add(id))requested.add(id);
        }
        Map<String,JSONObject> eligibleById=new HashMap<>();
        Set<String> waitingIds=new HashSet<>();
        synchronized(LOCK) {
            for(Map.Entry<String,?> e:prefs(c).getAll().entrySet())try {
                JSONObject meta=new JSONObject(String.valueOf(e.getValue()));
                String id=meta.optString("id");
                if(!id.matches("[a-f0-9]{32}"))continue;
                Download d=getDownload(c,id);
                String state=stateOf(d);
                String status=meta.optString("status");
                boolean folder="folder".equals(meta.optString("storageMode"))&&meta.optBoolean("exportVerified",false);
                if(folder)status="completed";
                else if(!state.isEmpty()&&!("failed".equals(state)&&"resolving".equals(status)))status=state;
                if("queued".equals(status)||"resolving".equals(status)||"downloading".equals(status)||"paused".equals(status)) {
                    eligibleById.put(id,meta);
                    if("queued".equals(status)&&"queued".equals(meta.optString("status"))&&(d==null||d.state==Download.STATE_FAILED))waitingIds.add(id);
                }
            }catch(Exception ignored){}
        }
        List<JSONObject> ordered=new ArrayList<>();
        for(String id:requested) {
            JSONObject meta=eligibleById.remove(id);
            if(meta!=null)ordered.add(meta);
        }
        List<JSONObject> remaining=new ArrayList<>(eligibleById.values());
        Collections.sort(remaining,OfflineStore::compareQueueRecords);
        ordered.addAll(remaining);

        synchronized(LOCK) {
            SharedPreferences.Editor editor=prefs(c).edit();
            boolean changed=false;
            for(int i=0;i<ordered.size();i++) {
                String id=ordered.get(i).optString("id");
                JSONObject current=get(c,id);
                if(current==null||current.optLong("queueOrder",-1)==i)continue;
                current.put("queueOrder",i);
                editor.putString(id,current.toString());
                changed=true;
            }
            if(changed&&!editor.commit())throw new IOException("Could not save the download queue order.");
        }

        // Only jobs that have not submitted a Media3 transfer can be safely
        // resubmitted in the new order. Resolving/downloading episodes and
        // any partial Media3 progress stay exactly where they are; the
        // worker gate applies this order to the next resolver slots.
        for(JSONObject orderedMeta:ordered) {
            String id=orderedMeta.optString("id");
            if(!waitingIds.contains(id))continue;
            JSONObject meta=get(c,id);
            if(meta==null||!"queued".equals(meta.optString("status")))continue;
            OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(DownloadWorker.class)
                .setInputData(new Data.Builder().putString("id",id).build())
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(
                    meta.optBoolean("autoDownload",false)&&meta.optBoolean("smartWifiOnly",false)
                        ?NetworkType.UNMETERED:NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR,10,TimeUnit.SECONDS)
                .addTag("moku-offline").build();
            meta.put("workId",work.getId().toString());put(c,meta);
            WorkManager.getInstance(c).enqueueUniqueWork("moku-"+id,ExistingWorkPolicy.REPLACE,work);
        }
        JSONArray order=new JSONArray();
        for(JSONObject meta:ordered)order.put(meta.optString("id"));
        return new JSONObject().put("ok",true).put("updated",ordered.size()).put("queueOrder",order);
    }
    static Download getDownload(Context c,String id) {
        try{return manager(c).getDownloadIndex().getDownload(id);}catch(Exception ignored){return null;}
    }
    static Download getDownloadStrict(Context c,String id) throws IOException {
        return manager(c).getDownloadIndex().getDownload(id);
    }
    static String stateOf(Download d) {
        if(d==null)return "";
        switch(d.state) {
            case Download.STATE_COMPLETED:return "completed";
            case Download.STATE_DOWNLOADING:return "downloading";
            case Download.STATE_QUEUED:case Download.STATE_RESTARTING:return "queued";
            case Download.STATE_STOPPED:return "paused";
            case Download.STATE_FAILED:return "failed";
            case Download.STATE_REMOVING:return "removing";
            default:return "queued";
        }
    }
    static JSONArray list(Context c) {
        List<JSONObject> all=new ArrayList<>();
        synchronized(LOCK) {
            for(Map.Entry<String,?> e:prefs(c).getAll().entrySet()) try {
                JSONObject meta=new JSONObject(String.valueOf(e.getValue()));
                Download d=getDownload(c,meta.optString("id"));
                String state=stateOf(d);
                boolean folder="folder".equals(meta.optString("storageMode"))&&meta.optBoolean("exportVerified",false);
                // Once verified, the folder copy is the playable episode even while cache removal runs.
                if(folder){meta.put("status","completed");meta.put("bytes",meta.optLong("exportBytes"));}
                // A new attempt may be resolving while an older failed Media3 record is still present.
                else if(!state.isEmpty() && !("failed".equals(state)&&"resolving".equals(meta.optString("status"))))meta.put("status",state);
                if(d!=null&&!folder) {
                    float percent=d.getPercentDownloaded();
                    if(percent!=C.PERCENTAGE_UNSET && percent>=0 && percent<=100)meta.put("progress",Math.round(percent));
                    meta.put("bytes",d.getBytesDownloaded());
                    if(d.state==Download.STATE_FAILED && meta.optString("error").isEmpty())meta.put("error","The host or network interrupted the download. Try again.");
                }
                all.add(meta);
            }catch(Exception ignored) { }
        }
        Collections.sort(all,(a,b)->Long.compare(b.optLong("added"),a.optLong("added")));
        // Recover a verifier/cleanup interrupted between its atomic metadata commit and scheduling.
        for(JSONObject data:all) {
            String cleanup=data.optString("cleanupStatus");
            if("verifying".equals(data.optString("exportStatus"))||"pending".equals(cleanup)||"waiting".equals(cleanup))
                try{FolderCleanupWorker.schedule(c,data.optString("id"));}catch(Exception ignored){}
        }
        return new JSONArray(all);
    }
    /**
     * Resume interrupted downloads and folder copies after the process restarts.
     * Called from MokuApplication.onCreate (startup=true) and the periodic recovery
     * worker (startup=false). Startup resets in-flight phases so a download that was
     * mid-resolve or mid-transfer when the process died is re-driven from the queue;
     * the periodic pass only re-enqueues already-queued items so it never cancels a
     * worker that is actively handling a download.
     */
    static JSONObject recover(Context c,boolean startup) throws Exception {
        int downloads=0,exports=0,cleanups=0;
        List<String> requeueDownloads=new ArrayList<>();
        List<String> requeueExports=new ArrayList<>();
        List<String> rescheduleCleanups=new ArrayList<>();
        synchronized(LOCK) {
            List<JSONObject> records=new ArrayList<>();
            for(Map.Entry<String,?> e:prefs(c).getAll().entrySet()) {
                try {
                    JSONObject meta=new JSONObject(String.valueOf(e.getValue()));
                    if(meta.optString("id").matches("[a-f0-9]{32}"))records.add(meta);
                }catch(Exception ignored) { }
            }
            SharedPreferences.Editor editor=prefs(c).edit();
            boolean changed=false;
            for(JSONObject meta:records) {
                String id=meta.optString("id");
                String storageMode=meta.optString("storageMode");
                boolean exportVerified=meta.optBoolean("exportVerified",false);
                Download d=getDownload(c,id);
                String mediaState=stateOf(d);
                String storedStatus=meta.optString("status");
                String exportStatus=meta.optString("exportStatus");
                String cleanupStatus=meta.optString("cleanupStatus");
                boolean modified=false;
                if(startup&&RecoveryPlan.shouldResetDownload(storedStatus)) {
                    meta.put("status","queued");modified=true;
                }
                if(RecoveryPlan.shouldRequeueDownload(meta.optString("status"),mediaState,storageMode,exportVerified)
                    &&"queued".equals(meta.optString("status")))requeueDownloads.add(id);
                if(startup&&RecoveryPlan.shouldResetExport(exportStatus)) {
                    meta.put("exportStatus","queued");modified=true;
                }
                if(RecoveryPlan.shouldRescheduleCleanup(meta.optString("exportStatus"),cleanupStatus))rescheduleCleanups.add(id);
                else if(RecoveryPlan.shouldRequeueExport(meta.optString("exportStatus"))
                    &&"queued".equals(meta.optString("exportStatus")))requeueExports.add(id);
                if(modified) {
                    changed=true;
                    editor.putString(id,meta.toString());
                }
            }
            if(changed&&!editor.commit())throw new IOException("Could not save recovery state.");
        }
        for(String id:requeueDownloads) {
            try { enqueueDownloadWork(c,id);downloads++; }catch(Exception ignored) { }
        }
        for(String id:requeueExports) {
            try { requeueExportWork(c,id);exports++; }catch(Exception ignored) { }
        }
        for(String id:rescheduleCleanups) {
            try { FolderCleanupWorker.schedule(c,id);cleanups++; }catch(Exception ignored) { }
        }
        return new JSONObject().put("recovered",downloads+exports+cleanups)
            .put("downloads",downloads).put("exports",exports).put("cleanups",cleanups);
    }
    /** True when there is any non-terminal download or export that may need resuming. */
    static boolean hasPendingRecovery(Context c) {
        synchronized(LOCK) {
            for(Map.Entry<String,?> e:prefs(c).getAll().entrySet()) {
                try {
                    JSONObject meta=new JSONObject(String.valueOf(e.getValue()));
                    if(!meta.optString("id").matches("[a-f0-9]{32}"))continue;
                    String storageMode=meta.optString("storageMode");
                    boolean exportVerified=meta.optBoolean("exportVerified",false);
                    Download d=getDownload(c,meta.optString("id"));
                    String mediaState=stateOf(d);
                    if(RecoveryPlan.shouldRequeueDownload(meta.optString("status"),mediaState,storageMode,exportVerified))return true;
                    if(RecoveryPlan.shouldRequeueExport(meta.optString("exportStatus")))return true;
                    if(RecoveryPlan.shouldRescheduleCleanup(meta.optString("exportStatus"),meta.optString("cleanupStatus")))return true;
                }catch(Exception ignored) { }
            }
        }
        return false;
    }
    /** (Re)create the DownloadWorker for a queued download, mirroring the enqueue path. */
    private static void enqueueDownloadWork(Context c,String id) throws Exception {
        JSONObject meta=get(c,id);if(meta==null)return;
        OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(DownloadWorker.class)
            .setInputData(new Data.Builder().putString("id",id).build())
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(
                meta.optBoolean("autoDownload",false)&&meta.optBoolean("smartWifiOnly",false)
                    ?NetworkType.UNMETERED:NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.LINEAR,10,TimeUnit.SECONDS)
            .addTag("moku-offline").build();
        meta.put("workId",work.getId().toString());put(c,meta);
        WorkManager.getInstance(c).enqueueUniqueWork("moku-"+id,ExistingWorkPolicy.REPLACE,work);
    }
    /** Re-enqueue an interrupted ExportWorker with the same job so a newer save is not started. */
    private static void requeueExportWork(Context c,String id) throws Exception {
        JSONObject meta=get(c,id);if(meta==null)return;
        Download d=getDownload(c,id);
        boolean fromFolder="folder".equals(meta.optString("storageMode"))&&!meta.optString("exportUri").isEmpty();
        if(!fromFolder&&(d==null||d.state!=Download.STATE_COMPLETED))return;
        String tree=ExportStore.folderUri(c);
        if(tree.isEmpty()||!ExportStore.hasPermission(c,Uri.parse(tree)))return;
        String job=meta.optString("exportJob");
        if(job.isEmpty()) {
            String generated="recovery-"+UUID.randomUUID().toString();
            if(!change(c,id,data->data.put("exportJob",generated)))return;
            job=generated;
        }
        final String exportJob=job;
        String name=ExportStore.folderName(c);
        OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(ExportWorker.class)
            .setInputData(new Data.Builder().putString("id",id).putString("tree",tree)
                .putString("folderName",name).putString("job",exportJob).build())
            .addTag("moku-export").build();
        if(!change(c,id,data->{if(!exportJob.equals(data.optString("exportJob")))throw new IOException("A newer save replaced this copy.");
            data.put("exportStatus","queued");data.put("exportError","");data.put("exportNextFolder",name);}))return;
        WorkManager.getInstance(c).enqueueUniqueWork(ExportStore.workName(id),ExistingWorkPolicy.REPLACE,work);
    }
    static JSONObject enqueue(Context c,String payload) throws Exception {
        return enqueue(c,payload,false,false,false);
    }
    static JSONObject enqueue(Context c,String payload,boolean autoDownload,boolean wifiOnly,boolean notifyWhenReady) throws Exception {
        if(payload==null||payload.length()>350000)throw new IOException("Selection is too large");
        JSONObject input=new JSONObject(payload);JSONArray episodes=input.getJSONArray("episodes");
        if(episodes.length()<1||episodes.length()>50)throw new IOException("Choose between 1 and 50 episodes per batch");
        String lang=input.optString("language","english");if(!lang.equals("english")&&!lang.equals("indonesian"))lang="english";
        String server=input.optString("server","auto"),quality=input.optString("quality","best");
        VideoResolver.validateSelection(server,quality);
        if("auto".equals(server)&&!"best".equals(quality))throw new IOException("Choose a server before selecting a specific quality");
        SubtitlePolicy.Selection subtitleSelection=SubtitlePolicy.selectionFromInput(input,server);
        int added=0,skipped=0;
        long nextQueueOrder=nextQueueOrder(c);
        for(int i=0;i<episodes.length();i++) {
            JSONObject pair=episodes.getJSONObject(i), item=pair.getJSONObject("item"), ep=pair.getJSONObject("episode");
            String src=item.optString("source"), epUrl=ep.optString("url"), seriesUrl=item.optString("url");
            if(!"auto".equals(server)&&!server.startsWith(src+"-"))throw new IOException("Download server and source do not match");
            if(!Network.allowedSource(epUrl)||!Network.allowedSource(seriesUrl))throw new IOException("Invalid source URL in selection");
            if(!Network.matchesSource(src,epUrl)||!Network.matchesSource(src,seriesUrl))
                throw new IOException("Source and episode do not match");
            if(ep.optString("ids").length()>1000||item.optString("title").length()>500||epUrl.length()>2000)throw new IOException("Episode information is too large");
            String id=idFor(src,epUrl);
            JSONObject old=get(c,id);Download existing=getDownload(c,id);
            if(old!=null && (existing==null && !"failed".equals(old.optString("status")) || existing!=null && existing.state!=Download.STATE_FAILED)) { skipped++;continue; }
            JSONObject cleanItem=new JSONObject();
            for(String key:new String[]{"source","url","title","image","type"})cleanItem.put(key,item.optString(key));
            JSONObject cleanEp=new JSONObject();
            for(String key:new String[]{"url","number","title","ids"})cleanEp.put(key,ep.optString(key));
            String episodeLanguage=SubtitlePolicy.languageFor(src,lang);
            JSONObject meta=new JSONObject().put("id",id).put("item",cleanItem).put("episode",cleanEp).put("language",episodeLanguage)
                .put("serverChoice",server).put("qualityChoice",quality)
                .put("subtitleMode",subtitleSelection.mode).put("subtitleSelection",new JSONArray(subtitleSelection.tracks.toString()))
                .put("preferredSubtitleLanguage",subtitleSelection.preferredLanguage)
                .put("autoDownload",autoDownload).put("smartWifiOnly",autoDownload&&wifiOnly).put("smartNotify",autoDownload&&notifyWhenReady).put("readyNotifiedAt",0L)
                .put("status","queued").put("queueOrder",nextQueueOrder++).put("error","").put("subtitleDescription","Preparing subtitles")
                .put("added",System.currentTimeMillis());
            OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(DownloadWorker.class)
                .setInputData(new Data.Builder().putString("id",id).build())
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(autoDownload&&wifiOnly?NetworkType.UNMETERED:NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.LINEAR,10,TimeUnit.SECONDS)
                .addTag("moku-offline").build();
            meta.put("workId",work.getId().toString());put(c,meta);
            WorkManager.getInstance(c).enqueueUniqueWork("moku-"+id,ExistingWorkPolicy.REPLACE,work);
            added++;
        }
        // Keep the periodic recovery alive while the queue is non-empty.
        BackgroundDownloads.refresh(c);
        return new JSONObject().put("added",added).put("skipped",skipped);
    }
    static void remove(Context c,String id) throws Exception {
        if(!id.matches("[a-f0-9]{32}"))throw new IOException("Invalid download ID");
        synchronized(PrivateAccess.class) {
            JSONObject meta=get(c,id);if(meta==null)return;
            if(PrivateAccess.inUse(id))throw new IOException("Close the offline player before removing this episode.");
            Download download=getDownloadStrict(c,id);
            if(download!=null&&!CacheScopes.isolated(download.request)) {
                // Older downloads share unscoped HLS keys. Never send Media3's unfiltered
                // removal for them; it could delete segments needed by other episodes.
                if(download.state==Download.STATE_COMPLETED) {
                    if(!LegacyCacheCleanup.remove(c,download,true))throw new IOException("An older shared download is still active. Try removing this episode again when it finishes.");
                } else if(download.state==Download.STATE_FAILED) {
                    // Failed downloads are terminal. Keep any partial shared cache spans rather
                    // than guessing which other records need them.
                    ((androidx.media3.exoplayer.offline.WritableDownloadIndex)manager(c).getDownloadIndex()).removeDownload(id);
                } else throw new IOException("Wait for this older download to finish or fail before removing it safely.");
            }
            synchronized(LOCK) {if(!prefs(c).edit().remove(id).commit())throw new IOException("Could not remove download information.");}
            String work=meta.optString("workId");
            if(!work.isEmpty())try{WorkManager.getInstance(c).cancelWorkById(UUID.fromString(work));}catch(Exception ignored){}
            WorkManager.getInstance(c).cancelUniqueWork(ExportStore.workName(id));
            WorkManager.getInstance(c).cancelUniqueWork(FolderCleanupWorker.name(id));
            if(download!=null&&CacheScopes.isolated(download.request))DownloadService.sendRemoveDownload(c,MokuDownloadService.class,id,true);
            deleteTree(subtitleDir(c,id));
        }
    }
    static File subtitleDir(Context c,String id) {
        if(!id.matches("[a-f0-9]{32}"))throw new IllegalArgumentException("Invalid download ID");
        return new File(new File(c.getFilesDir(),"moku_offline_subtitles"),id);
    }
    static void deleteTree(File f) {
        if(f.isDirectory()) {File[] entries=f.listFiles();if(entries!=null)for(File x:entries)deleteTree(x);}f.delete();
    }
}
