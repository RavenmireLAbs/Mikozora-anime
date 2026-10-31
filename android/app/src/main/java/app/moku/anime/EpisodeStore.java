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
    private static final int MAX_TITLES=2000,MAX_EVENTS=500;
    private EpisodeStore() {}
    static SharedPreferences preferences(Context c){return c.getApplicationContext().getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    private static JSONObject read(Context c) throws Exception {
        String raw=preferences(c).getString(DATA,null);
        if(raw==null)return new JSONObject().put("titles",new JSONObject()).put("events",new JSONArray()).put("automatic",true).put("alerts",true);
        JSONObject db=new JSONObject(raw);
        if(db.optJSONObject("titles")==null||db.optJSONArray("events")==null)throw new IOException("Episode update data could not be read");
        return db;
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
        JSONArray input=new JSONArray(payload);
        if(input.length()>MAX_TITLES)throw new IOException("Too many collection titles to check");
        JSONObject db=read(c),old=db.getJSONObject("titles"),next=new JSONObject();
        boolean added=false,changed=false;
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
            track.put("item",item);next.put(id,track);
        }
        if(old.length()!=next.length())changed=true;
        // A removed title starts a fresh baseline if it is later added again. Its
        // old alerts are also removed; downloads and library data are separate.
        JSONArray events=db.getJSONArray("events"),kept=new JSONArray();
        for(int i=0;i<events.length();i++) {
            JSONObject e=events.optJSONObject(i);
            if(e!=null&&ids.contains(e.optString("titleId")))kept.put(e);else changed=true;
        }
        db.put("titles",next).put("events",kept);
        if(changed)save(c,db);
        return new JSONObject().put("added",added).put("changed",changed).put("watchedCount",next.length());
    }
    static synchronized boolean automatic(Context c) throws Exception {return read(c).optBoolean("automatic",true);}
    static synchronized boolean alerts(Context c) throws Exception {return read(c).optBoolean("alerts",true);}
    static synchronized int count(Context c) throws Exception {return read(c).getJSONObject("titles").length();}
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
    static synchronized int success(Context c,Title title,List<EpisodeFetcher.Episode> episodes,long now) throws Exception {
        JSONObject db=read(c),track=db.getJSONObject("titles").optJSONObject(title.id);
        if(track==null||!title.token.equals(track.optString("token")))return 0;
        List<JSONObject> found=EpisodeState.apply(track,episodes,now);
        JSONArray old=db.getJSONArray("events"),next=new JSONArray();Set<String> seen=new HashSet<>();
        for(JSONObject e:found)if(seen.add(e.getString("id"))&&next.length()<MAX_EVENTS)next.put(e);
        for(int i=0;i<old.length()&&next.length()<MAX_EVENTS;i++) {
            JSONObject e=old.optJSONObject(i);if(e!=null&&seen.add(e.optString("id")))next.put(e);
        }
        db.put("events",next);save(c,db);return found.size();
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
        return new JSONObject().put("automatic",db.optBoolean("automatic",true)).put("alerts",db.optBoolean("alerts",true))
            .put("watchedCount",titles.length()).put("initializedCount",initialized).put("unreadCount",unread)
            .put("lastSuccess",lastSuccess).put("lastRun",db.optLong("lastRun",0))
            .put("checking",db.optLong("runningUntil",0)>now).put("queued",db.optLong("pendingAt",0)>now-24*60*60_000L)
            .put("errors",errors).put("updates",events);
    }
}
