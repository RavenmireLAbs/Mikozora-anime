package app.moku.anime;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/** Private, atomic snapshot used by WorkManager even when no WebView exists. */
final class EpisodeStore {
    static final String PREFS="moku_episode_updates_v1", DATA="snapshot";
    static final long INTERVAL_MS=6L*60L*60L*1000L;
    private static final int MAX_TITLES=2000,MAX_EVENTS=500,MAX_WATCHED_EPISODES=5000;
    private EpisodeStore() {}
    static SharedPreferences preferences(Context c){return c.getApplicationContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    private static JSONObject read(Context c) throws Exception {
        String raw=preferences(c).getString(DATA,null);
        if(raw==null)return new JSONObject().put("titles",new JSONObject()).put("events",new JSONArray()).put("automatic",true).put("alerts",true).put("smartDownloads",normalizeSmartSettings(null));
        JSONObject db=new JSONObject(raw);
        if(db.optJSONObject("titles")==null||db.optJSONArray("events")==null)throw new IOException("Episode update data could not be read");
        return db;
    }
    private static String cleanText(String value,int max) {
        if(value==null)return "";
        String clean=value.replaceAll("[\\p{Cc}\\p{Cf}]"," ").replaceAll("\\s+"," ").trim();
        return clean.length()>max?clean.substring(0,max).trim():clean;
    }
    static JSONObject normalizeSmartSettings(JSONObject raw) throws Exception {
        int cap=raw==null?3:raw.optInt("maxUnwatchedPerSeries",3);
        if(cap<1)cap=1;if(cap>10)cap=10;
        return new JSONObject()
            .put("enabled",raw!=null&&raw.optBoolean("enabled",false))
            .put("wifiOnly",raw==null||raw.optBoolean("wifiOnly",true))
            .put("maxUnwatchedPerSeries",cap)
            .put("notifyWhenReady",raw==null||raw.optBoolean("notifyWhenReady",true));
    }
    static JSONObject sanitizeDownloadPreset(JSONObject raw) throws Exception {
        String server=cleanText(raw==null?"":raw.optString("server",""),120);
        String quality=cleanText(raw==null?"":raw.optString("quality",""),24);
        try { VideoResolver.validateSelection(server,quality); }
        catch(Exception invalid) { server="auto";quality="best"; }
        String subtitleMode="auto";JSONArray subtitleTracks=new JSONArray();
        try {
            JSONObject input=new JSONObject()
                .put("subtitleMode",raw==null?"auto":raw.optString("subtitleMode","auto"))
                .put("subtitleTracks",raw==null?new JSONArray():raw.optJSONArray("subtitleTracks"));
            SubtitlePolicy.Selection selection=SubtitlePolicy.selectionFromInput(input,server);
            subtitleMode=selection.mode;subtitleTracks=selection.tracks;
        }catch(Exception invalid) { subtitleMode="auto";subtitleTracks=new JSONArray(); }
        return new JSONObject()
            .put("language",raw!=null&&"indonesian".equals(raw.optString("language"))?"indonesian":"english")
            .put("server",server).put("quality",quality)
            .put("subtitleMode",subtitleMode).put("subtitleTracks",subtitleTracks);
    }
    private static JSONArray cleanWatchedEpisodes(JSONArray raw,String source) {
        JSONArray out=new JSONArray();Set<String> seen=new HashSet<>();
        if(raw==null)return out;
        for(int i=0;i<raw.length()&&out.length()<MAX_WATCHED_EPISODES;i++) {
            Object value=raw.opt(i);if(!(value instanceof String))continue;
            String url=cleanText((String)value,2500);
            if(!url.isEmpty()&&seen.add(url)&&Network.matchesSource(source,url))out.put(url);
        }
        return out;
    }
    private static boolean smartPending(String status) {return "pending".equals(status)||"pendingCap".equals(status);}
    private static boolean smartStatus(String status) {
        return smartPending(status)||"queued".equals(status)||"existing".equals(status)||"watched".equals(status)||"skipped".equals(status)||"failed".equals(status);
    }
    private static void save(Context c,JSONObject db) throws IOException {
        if(!preferences(c).edit().putString(DATA,db.toString()).commit())throw new IOException("Could not save episode updates");
    }
    private static String bounded(JSONObject o,String key,int max) throws Exception {
        String value=o.optString(key,"").trim();
        if(value.length()>max)throw new IOException("Invalid collection title");
        return value;
    }
    static synchronized JSONObject sync(Context c,String payload) throws Exception {
        if(payload==null||payload.length()>6_000_000)throw new IOException("Collection snapshot is too large");
        JSONObject db=read(c),old=db.getJSONObject("titles"),next=new JSONObject();
        boolean legacy=payload.trim().startsWith("[");
        JSONArray input;
        JSONObject nextSmartSettings;
        if(legacy) {
            input=new JSONArray(payload);
            nextSmartSettings=normalizeSmartSettings(db.optJSONObject("smartDownloads"));
        } else {
            JSONObject root=new JSONObject(payload);
            input=root.optJSONArray("titles");
            if(input==null)throw new IOException("Too many collection titles to check");
            nextSmartSettings=normalizeSmartSettings(root.optJSONObject("smartDownloads"));
        }
        if(input.length()>MAX_TITLES)throw new IOException("Too many collection titles to check");
        boolean added=false,changed=!nextSmartSettings.toString().equals(normalizeSmartSettings(db.optJSONObject("smartDownloads")).toString());
        Set<String> ids=new HashSet<>();
        for(int i=0;i<input.length();i++) {
            JSONObject x=input.getJSONObject(i);
            String source=bounded(x,"source",30),url=bounded(x,"url",2500),title=bounded(x,"title",500);
            if(title.isEmpty()||!Network.matchesSource(source,url))throw new IOException("A collection title has an invalid source");
            String id=source+"|"+url;
            if(!ids.add(id))continue;
            JSONObject item=new JSONObject().put("source",source).put("url",url).put("title",title)
                .put("image",bounded(x,"image",3000)).put("type",bounded(x,"type",100))
                .put("badge",bounded(x,"badge",100)).put("status",bounded(x,"status",200));
            JSONObject track=old.optJSONObject(id);
            if(track==null) {
                track=new JSONObject().put("id",id).put("token",UUID.randomUUID().toString()).put("baseline",false)
                    .put("known",new JSONObject()).put("maxNumber",-1).put("lastAttempt",0);
                added=true;changed=true;
            } else if(!item.toString().equals(track.getJSONObject("item").toString()))changed=true;
            boolean smartDownload=legacy?track.optBoolean("smartDownload",false):x.optBoolean("smartDownload",false);
            JSONObject downloadPreset=legacy&&track.has("downloadPreset")
                ?sanitizeDownloadPreset(track.optJSONObject("downloadPreset"))
                :sanitizeDownloadPreset(x.optJSONObject("downloadPreset"));
            JSONArray watchedEpisodes=smartDownload
                ?cleanWatchedEpisodes(legacy?track.optJSONArray("watchedEpisodes"):x.optJSONArray("watchedEpisodes"),source)
                :new JSONArray();
            JSONObject previousPreset=sanitizeDownloadPreset(track.optJSONObject("downloadPreset"));
            JSONArray previousWatched=track.optJSONArray("watchedEpisodes");if(previousWatched==null)previousWatched=new JSONArray();
            if(track.optBoolean("smartDownload",false)!=smartDownload
                ||!downloadPreset.toString().equals(previousPreset.toString())
                ||!watchedEpisodes.toString().equals(previousWatched.toString()))changed=true;
            track.put("item",item).put("smartDownload",smartDownload).put("downloadPreset",downloadPreset).put("watchedEpisodes",watchedEpisodes);
            next.put(id,track);
        }
        if(old.length()!=next.length())changed=true;
        // A removed title starts a fresh baseline if it is later added again. Its
        // old alerts are also removed; downloads and library data are separate.
        JSONArray events=db.getJSONArray("events"),kept=new JSONArray();
        for(int i=0;i<events.length();i++) {
            JSONObject e=events.optJSONObject(i);
            if(e!=null&&ids.contains(e.optString("titleId"))) {
                JSONObject track=next.optJSONObject(e.optString("titleId"));
                String smartStatus=e.optString("smartDownloadStatus","");
                boolean active=nextSmartSettings.optBoolean("enabled",false)&&track!=null&&track.optBoolean("smartDownload",false);
                if(smartPending(smartStatus)&&!active) {e.put("smartDownloadStatus","skipped");changed=true;}
                else if(!legacy&&"failed".equals(smartStatus)&&active) {e.put("smartDownloadStatus","pending");e.remove("smartDownloadError");changed=true;}
                kept.put(e);
            }else changed=true;
        }
        db.put("titles",next).put("events",kept).put("smartDownloads",nextSmartSettings);
        if(changed)save(c,db);
        return new JSONObject().put("added",added).put("changed",changed).put("watchedCount",next.length());
    }
    static synchronized boolean automatic(Context c) throws Exception {return read(c).optBoolean("automatic",true);}
    static synchronized boolean alerts(Context c) throws Exception {return read(c).optBoolean("alerts",true);}
    static synchronized int count(Context c) throws Exception {return read(c).getJSONObject("titles").length();}
    static synchronized JSONObject smartSettings(Context c) throws Exception {return normalizeSmartSettings(read(c).optJSONObject("smartDownloads"));}
    static synchronized JSONObject track(Context c,String id) throws Exception {
        JSONObject track=read(c).getJSONObject("titles").optJSONObject(id);
        return track==null?null:new JSONObject(track.toString());
    }
    private static double episodeNumeric(JSONObject event) {
        try{return Double.parseDouble(event.getJSONObject("episode").optString("number"));}catch(Exception ignored){return Double.MAX_VALUE;}
    }
    static synchronized List<JSONObject> pendingSmartDownloads(Context c) throws Exception {
        JSONObject db=read(c),titles=db.getJSONObject("titles");JSONArray events=db.getJSONArray("events");
        List<JSONObject> out=new ArrayList<>();
        for(int i=0;i<events.length();i++) {
            JSONObject e=events.optJSONObject(i);
            if(e!=null&&smartPending(e.optString("smartDownloadStatus"))&&titles.optJSONObject(e.optString("titleId"))!=null)out.add(new JSONObject(e.toString()));
        }
        java.util.Collections.sort(out,(a,b)->{
            int byTime=Long.compare(a.optLong("discoveredAt",0),b.optLong("discoveredAt",0));if(byTime!=0)return byTime;
            int byTitle=a.optString("titleId").compareTo(b.optString("titleId"));if(byTitle!=0)return byTitle;
            int byNumber=Double.compare(episodeNumeric(a),episodeNumeric(b));if(byNumber!=0)return byNumber;
            String au=a.optJSONObject("episode")==null?"":a.optJSONObject("episode").optString("url");
            String bu=b.optJSONObject("episode")==null?"":b.optJSONObject("episode").optString("url");
            return au.compareTo(bu);
        });
        return out;
    }
    static synchronized boolean markSmartDownload(Context c,String id,String status,String error,long now) throws Exception {
        if(!smartStatus(status))return false;
        JSONObject db=read(c);JSONArray events=db.getJSONArray("events");
        for(int i=0;i<events.length();i++) {
            JSONObject e=events.optJSONObject(i);if(e==null||!id.equals(e.optString("id")))continue;
            e.put("smartDownloadStatus",status).put("smartDownloadUpdatedAt",now);
            if("queued".equals(status))e.remove("smartDownloadError");
            if("failed".equals(status)) {
                e.put("smartDownloadAttempts",e.optInt("smartDownloadAttempts",0)+1);
                e.put("smartDownloadError",cleanText(error==null||error.isEmpty()?"Could not queue this episode automatically":error,220));
            }
            save(c,db);return true;
        }
        return false;
    }
    static synchronized void setAutomatic(Context c,boolean value) throws Exception {
        JSONObject db=read(c);db.put("automatic",value);
        if(!value&&"auto".equals(db.optString("pendingMode"))){db.remove("pendingAt");db.remove("pendingMode");}
        save(c,db);
    }
    static synchronized void setAlerts(Context c,boolean value) throws Exception {JSONObject db=read(c);db.put("alerts",value);save(c,db);}
    static synchronized void queued(Context c,boolean manual) throws Exception {
        JSONObject db=read(c);db.put("pendingAt",System.currentTimeMillis()).put("pendingMode",manual?"manual":"auto");save(c,db);
    }
    static synchronized String begin(Context c) throws Exception {
        JSONObject db=read(c);String run=UUID.randomUUID().toString();long now=System.currentTimeMillis();
        db.put("running",run).put("runningUntil",now+9*60_000L).put("lastRun",now);
        db.remove("pendingAt");db.remove("pendingMode");save(c,db);return run;
    }
    static synchronized void finish(Context c,String run) throws Exception {
        JSONObject db=read(c);if(run!=null&&run.equals(db.optString("running"))){db.remove("running");db.remove("runningUntil");save(c,db);}
    }
    static final class Title {
        final String id,token,source,url;final long attempt;
        Title(JSONObject track) throws Exception {
            id=track.getString("id");token=track.getString("token");JSONObject item=track.getJSONObject("item");
            source=item.getString("source");url=item.getString("url");attempt=track.optLong("lastAttempt",0);
        }
    }
    static synchronized List<Title> due(Context c,long cutoff) throws Exception {
        JSONObject titles=read(c).getJSONObject("titles");List<Title> out=new ArrayList<>();
        java.util.Iterator<String> it=titles.keys();
        while(it.hasNext()) {
            JSONObject track=titles.getJSONObject(it.next());Title title=new Title(track);
            if(title.attempt==0||title.attempt<cutoff)out.add(title);
        }
        java.util.Collections.sort(out,(a,b)->Long.compare(a.attempt,b.attempt));return out;
    }
    static synchronized List<JSONObject> successEvents(Context c,Title title,List<EpisodeFetcher.Episode> episodes,long now) throws Exception {
        JSONObject db=read(c),track=db.getJSONObject("titles").optJSONObject(title.id);
        if(track==null||!title.token.equals(track.optString("token")))return new ArrayList<>();
        List<JSONObject> found=EpisodeState.apply(track,episodes,now);
        JSONObject settings=normalizeSmartSettings(db.optJSONObject("smartDownloads"));
        if(settings.optBoolean("enabled",false)&&track.optBoolean("smartDownload",false)) {
            for(JSONObject e:found)e.put("smartDownloadStatus","pending").put("smartDownloadUpdatedAt",now);
        }
        JSONArray old=db.getJSONArray("events"),next=new JSONArray();Set<String> seen=new HashSet<>();
        List<JSONObject> inserted=new ArrayList<>();
        for(JSONObject e:found)if(seen.add(e.getString("id"))&&next.length()<MAX_EVENTS){next.put(e);inserted.add(new JSONObject(e.toString()));}
        for(int i=0;i<old.length()&&next.length()<MAX_EVENTS;i++) {
            JSONObject e=old.optJSONObject(i);if(e!=null&&seen.add(e.optString("id")))next.put(e);
        }
        db.put("events",next);save(c,db);return inserted;
    }
    static synchronized int success(Context c,Title title,List<EpisodeFetcher.Episode> episodes,long now) throws Exception {
        return successEvents(c,title,episodes,now).size();
    }
    static synchronized void failure(Context c,Title title,String error,long now) throws Exception {
        JSONObject db=read(c),track=db.getJSONObject("titles").optJSONObject(title.id);
        if(track==null||!title.token.equals(track.optString("token")))return;
        track.put("lastAttempt",now).put("error",safeError(error));save(c,db);
    }
    private static String safeError(String error) {
        String s=error==null?"":error.trim();
        if(s.startsWith("Source returned HTTP ")&&s.matches("Source returned HTTP [0-9]{3}"))return s;
        if(s.toLowerCase(java.util.Locale.ROOT).contains("timed out"))return "Source timed out";
        if(s.startsWith("Source episode list")||s.startsWith("Source did not return")||s.startsWith("Source episode links")||s.startsWith("Series episode list")||s.startsWith("AnimeBash did not provide"))return s.length()>160?s.substring(0,160):s;
        return "Could not check this source";
    }
    static synchronized void markRead(Context c,String id,boolean all) throws Exception {
        JSONObject db=read(c);JSONArray events=db.getJSONArray("events");boolean changed=false;
        for(int i=0;i<events.length();i++){JSONObject e=events.optJSONObject(i);if(e!=null&&!e.optBoolean("read")&&(all||e.optString("id").equals(id))){e.put("read",true);changed=true;}}
        if(changed)save(c,db);
    }
    static synchronized JSONObject state(Context c) throws Exception {
        JSONObject db=read(c),titles=db.getJSONObject("titles");JSONArray events=db.getJSONArray("events"),errors=new JSONArray();
        int initialized=0,unread=0;long lastSuccess=0;
        java.util.Iterator<String> it=titles.keys();
        while(it.hasNext()) {
            JSONObject t=titles.getJSONObject(it.next());if(t.optBoolean("baseline"))initialized++;
            lastSuccess=Math.max(lastSuccess,t.optLong("lastSuccess",0));
            if(!t.optString("error").isEmpty())errors.put(new JSONObject().put("item",t.getJSONObject("item")).put("message",t.optString("error")).put("at",t.optLong("lastAttempt")));
        }
        for(int i=0;i<events.length();i++){JSONObject e=events.optJSONObject(i);if(e!=null&&!e.optBoolean("read"))unread++;}
        long now=System.currentTimeMillis();
        return new JSONObject().put("automatic",db.optBoolean("automatic",true)).put("alerts",db.optBoolean("alerts",true)).put("smartDownloads",normalizeSmartSettings(db.optJSONObject("smartDownloads")))
            .put("watchedCount",titles.length()).put("initializedCount",initialized).put("unreadCount",unread)
            .put("lastSuccess",lastSuccess).put("lastRun",db.optLong("lastRun",0))
            .put("checking",db.optLong("runningUntil",0)>now).put("queued",db.optLong("pendingAt",0)>now-24*60*60_000L)
            .put("errors",errors).put("updates",events);
    }
}
