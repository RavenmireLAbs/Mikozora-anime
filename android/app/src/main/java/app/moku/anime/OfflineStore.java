package app.moku.anime;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;
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
    static JSONObject enqueue(Context c,String payload) throws Exception {
        if(payload==null||payload.length()>350000)throw new IOException("Selection is too large");
        JSONObject input=new JSONObject(payload);JSONArray episodes=input.getJSONArray("episodes");
        if(episodes.length()<1||episodes.length()>50)throw new IOException("Choose between 1 and 50 episodes per batch");
        String lang=input.optString("language","english");if(!lang.equals("english")&&!lang.equals("indonesian"))lang="english";
        String server=input.optString("server","auto"),quality=input.optString("quality","best");
        VideoResolver.validateSelection(server,quality);
        if("auto".equals(server)&&!"best".equals(quality))throw new IOException("Choose a server before selecting a specific quality");
        int added=0,skipped=0;
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
                .put("status","queued").put("error","").put("subtitleDescription","Preparing subtitles")
                .put("added",System.currentTimeMillis());
            OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(DownloadWorker.class)
                .setInputData(new Data.Builder().putString("id",id).build())
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .addTag("moku-offline").build();
            meta.put("workId",work.getId().toString());put(c,meta);
            WorkManager.getInstance(c).enqueueUniqueWork("moku-"+id,ExistingWorkPolicy.REPLACE,work);
            added++;
        }
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
