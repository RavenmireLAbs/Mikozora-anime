package app.moku.anime;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipFile;

/** Offline fixture and state regressions for the actual native episode checker. */
public final class EpisodeUpdatesSmoke {
    static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
    static class MemoryContext extends Context implements SharedPreferences {
        final Map<String,String> data=new HashMap<>();
        @Override public SharedPreferences getSharedPreferences(String name,int mode){return this;}
        @Override public String getString(String key,String fallback){return data.containsKey(key)?data.get(key):fallback;}
        @Override public Editor edit(){return new Editor(){String key,value;public Editor putString(String k,String v){key=k;value=v;return this;}public boolean commit(){data.put(key,value);return true;}};}
    }
    static EpisodeFetcher.Episode ep(String n){return new EpisodeFetcher.Episode("number:"+n,n,"Episode "+n,"https://animesogo.to/watch/a/ep-"+n,Double.parseDouble(n));}
    static JSONObject item(String source,String url,String title) throws Exception {return new JSONObject().put("source",source).put("url",url).put("title",title);}
    static EpisodeFetcher.TextSource supplied(Map<String,String> values){return url->{String value=values.get(url);if(value==null)throw new IOException("Unexpected request "+url);return value;};}
    static void rejected(Throwing run,String message) throws Exception {try{run.run();throw new AssertionError(message);}catch(IOException expected){}}
    interface Throwing{void run()throws Exception;}
    static void fixtureParsers() throws Exception {
        String[] watch={"sogo","suge","anikoto","waves"};
        for(String source:watch) {
            String base=Network.sourceBase(source),url=base+(source.equals("suge")?"/anime/test":"/watch/test");
            Map<String,String> values=new HashMap<>();
            values.put(url,source.equals("sogo")?"<div id='watch-page' data-id='42'></div>":"<div class='watch-wrap' data-id='42'></div>");
            String html=source.equals("sogo")?"<ul class='episodes'><li><a data-num='1'></a></li><li><a data-num='2'></a></li><li><a data-num='2'></a></li></ul>":
                "<ul><li><a data-num='1' data-slug='1' data-ids='42' href='/watch/test/ep-1'></a></li><li><a data-num='Full' data-slug='2' data-ids='43' href='/watch/test/ep-2'></a></li></ul>";
            values.put(base+"/ajax/episode/list/42?vrf=",new JSONObject().put("status",200).put("result",html).toString());
            List<EpisodeFetcher.Episode> eps=EpisodeFetcher.fetch(source,url,supplied(values));
            require(eps.size()==2,source+" should produce two deduplicated episodes");
            require(eps.get(0).number.equals("1")&&eps.get(1).number.equals("2"),source+" numeric identity");
            require(Network.matchesSource(source,eps.get(1).url),source+" validated episode URL");
            values.put(base+"/ajax/episode/list/42?vrf=",new JSONObject().put("status",200).put("result","<ul></ul>").toString());
            rejected(()->EpisodeFetcher.fetch(source,url,supplied(values)),source+" empty response must not initialize or alert");
        }
        for(String source:new String[]{"xin","rulz","narul","stream","world"}) {
            String base=Network.sourceBase(source),url=base+"/anime/example/";
            String links=source.equals("rulz")?"<ul class='episodes-ul'><li><a class='ep-item' data-number='1' href='/example-episode-1/'></a></li><li><a class='ep-item' data-number='2' href='/example-episode-2/'></a></li></ul>":
                "<div class='eplister'><ul><li><a href='/example-episode-2/'><div class='epl-num'>2</div><div class='epl-title'>Second</div></a></li><li><a href='/example-episode-1/'><div class='epl-num'>Episode 1</div></a></li></ul></div>";
            Map<String,String> values=new HashMap<>();values.put(url,links);
            List<EpisodeFetcher.Episode> eps=EpisodeFetcher.fetch(source,url,supplied(values));
            require(eps.size()==2,source+" WordPress links");
            require(eps.stream().anyMatch(e->e.number.equals("1"))&&eps.stream().anyMatch(e->e.number.equals("2")),source+" episode numbers");
            values.put(url,"<div class='eplister'></div>");
            rejected(()->EpisodeFetcher.fetch(source,url,supplied(values)),source+" empty airing listing must not initialize");
            values.put(url,"<div class='spe'><span>Status: Upcoming</span></div><div class='eplister'></div>");
            require(EpisodeFetcher.fetch(source,url,supplied(values)).isEmpty(),source+" explicit upcoming empty baseline");
            values.put(url,"<div class='eplister'><ul><li><a href='https://evil.test/ep'><div class='epl-num'>3</div></a></li></ul></div>");
            rejected(()->EpisodeFetcher.fetch(source,url,supplied(values)),source+" untrusted links rejected");
        }
        String base=Network.sourceBase("bash"),url=base+"/anime/20";Map<String,String> bash=new HashMap<>();
        bash.put(base+"/api/anime/20","{\"title\":{\"romaji\":\"Naruto\"},\"status\":\"FINISHED\",\"episodes\":220}");
        bash.put(base+"/api/watch/20","{\"episodes\":[{\"number\":20,\"title\":\"B\"},{\"number\":10,\"title\":\"A\"}]} ");
        List<EpisodeFetcher.Episode> eps=EpisodeFetcher.fetch("bash",url,supplied(bash));
        require(eps.size()==2&&eps.get(0).number.equals("1")&&eps.get(0).title.equals("A")&&eps.get(1).number.equals("2"),"Bash follows the supplied partial sorted watch list, not the metadata total");
        bash.put(base+"/api/watch/20","{\"episodes\":[{\"number\":1,\"airDateUtc\":\"2000-01-01T00:00:00Z\"},{\"number\":2,\"airDateUtc\":\"2099-01-01T00:00:00Z\"},{\"number\":3,\"airDate\":\"2099-01-01\"}]}");
        require(EpisodeFetcher.fetch("bash",url,supplied(bash)).size()==1,"Bash future-dated metadata is not reported as available");
        bash.put(base+"/api/watch/20","{\"episodes\":[]}");
        rejected(()->EpisodeFetcher.fetch("bash",url,supplied(bash)),"Bash empty released list is an error rather than 220 invented links");
        bash.put(base+"/api/anime/20","{\"title\":{\"romaji\":\"Soon\"},\"status\":\"NOT_YET_RELEASED\"}");
        require(EpisodeFetcher.fetch("bash",url,supplied(bash)).isEmpty(),"Bash explicitly upcoming empty baseline");
        rejected(()->EpisodeFetcher.fetch("sogo","https://animexin.dev/anything",supplied(Collections.emptyMap())),"source and URL must match");
        require(EpisodeFetcher.canonical("001.500").equals("1.5"),"canonical decimal identity");
        System.out.println("PASS all ten source fixtures, empty/upcoming/partial/error and exact-host validation");
    }
    static void reducer() throws Exception {
        JSONObject t=new JSONObject().put("id","sogo|a").put("item",item("sogo","https://animesogo.to/watch/a","A"));
        require(EpisodeState.apply(t,Arrays.asList(ep("3"),ep("1"),ep("2")),100).isEmpty(),"first check is a silent baseline");
        require(t.optDouble("maxNumber")==3,"baseline maximum regardless of order");
        List<JSONObject> result=EpisodeState.apply(t,Arrays.asList(ep("5"),ep("4"),ep("1")),200);
        require(result.size()==2,"both later episodes found independent of response order");
        require(EpisodeState.apply(t,Arrays.asList(ep("1")),300).isEmpty(),"partial response is silent");
        require(EpisodeState.apply(t,Arrays.asList(ep("1"),ep("2"),ep("3"),ep("4"),ep("5")),400).isEmpty(),"restored/identical episode list does not repeat alerts");
        require(EpisodeState.apply(t,Collections.emptyList(),500).isEmpty(),"empty response does not generate updates");
        require(EpisodeState.apply(t,Arrays.asList(ep("5"),ep("6")),600).size()==1,"later addition after an empty response");
        JSONObject upcoming=new JSONObject().put("id","sogo|soon").put("item",item("sogo","https://animesogo.to/watch/a","Soon"));
        require(EpisodeState.apply(upcoming,Collections.emptyList(),100).isEmpty(),"empty upcoming baseline silent");
        require(EpisodeState.apply(upcoming,Arrays.asList(ep("1")),200).size()==1,"episode one arriving after an explicit upcoming baseline");
        System.out.println("PASS baselines, new and repeated episodes, reversed/partial/empty results and upcoming first episode");
    }
    static void store() throws Exception {
        MemoryContext c=new MemoryContext();JSONObject first=item("sogo","https://animesogo.to/watch/a","A");
        JSONObject second=item("xin","https://animexin.dev/anime/b/","B");
        JSONArray input=new JSONArray().put(first).put(second).put(first);
        require(EpisodeStore.sync(c,input.toString()).getInt("watchedCount")==2,"duplicate title snapshots are monitored once");
        require(!EpisodeStore.sync(c,input.toString()).getBoolean("changed"),"identical snapshots are stable");
        List<EpisodeStore.Title> due=EpisodeStore.due(c,1);require(due.size()==2,"both titles initially due");
        EpisodeStore.Title a=due.stream().filter(x->x.source.equals("sogo")).findFirst().get();
        require(EpisodeStore.success(c,a,Arrays.asList(ep("1"),ep("2")),100)==0,"first store check silent");
        require(EpisodeStore.success(c,a,Arrays.asList(ep("1"),ep("2"),ep("3")),200)==1,"one new update saved");
        require(EpisodeStore.success(c,a,Arrays.asList(ep("3"),ep("2")),300)==0,"repeat check silent");
        EpisodeStore.failure(c,a,"Source returned HTTP 403",400);
        require(EpisodeStore.state(c).getJSONArray("errors").length()==1,"source error visible");
        require(EpisodeStore.success(c,a,Arrays.asList(ep("2"),ep("3"),ep("4")),500)==1,"failure retained previous baseline");
        require(EpisodeStore.state(c).getInt("unreadCount")==2,"two unread events persist");
        EpisodeStore.markRead(c,"all",true);require(EpisodeStore.state(c).getInt("unreadCount")==0,"mark all read");
        EpisodeStore.setAutomatic(c,false);EpisodeStore.setAlerts(c,false);
        require(!EpisodeStore.state(c).getBoolean("automatic")&&!EpisodeStore.state(c).getBoolean("alerts"),"separate automatic and notification preferences");
        EpisodeStore.sync(c,new JSONArray().put(second).toString());
        require(EpisodeStore.state(c).getJSONArray("updates").length()==0,"removing last membership removes that title's updates only");
        EpisodeStore.sync(c,new JSONArray().put(first).put(second).toString());
        EpisodeStore.Title replacement=EpisodeStore.due(c,1000).stream().filter(x->x.source.equals("sogo")).findFirst().get();
        require(!a.token.equals(replacement.token),"re-adding has a fresh generation");
        require(EpisodeStore.success(c,a,Arrays.asList(ep("50")),800)==0,"in-flight result from removed generation ignored");
        require(EpisodeStore.success(c,replacement,Arrays.asList(ep("1"),ep("2"),ep("3")),900)==0,"re-added title gets a fresh silent baseline");
        AtomicInteger found=new AtomicInteger();CountDownLatch go=new CountDownLatch(1);List<Thread> threads=new ArrayList<>();
        for(int i=0;i<8;i++){Thread thread=new Thread(()->{try{go.await();found.addAndGet(EpisodeStore.success(c,replacement,Arrays.asList(ep("3"),ep("4")),1000));}catch(Exception e){throw new RuntimeException(e);}});threads.add(thread);thread.start();}
        go.countDown();for(Thread thread:threads)thread.join();
        require(found.get()==1&&EpisodeStore.state(c).getInt("unreadCount")==1,"concurrent workers produce one alert");
        String saved=c.data.get(EpisodeStore.DATA);c.data.put(EpisodeStore.DATA,"not-json");
        try{EpisodeStore.sync(c,input.toString());throw new AssertionError("corrupt state must not be silently overwritten");}catch(org.json.JSONException expected){}
        require(c.data.get(EpisodeStore.DATA).equals("not-json"),"corrupt state preserved");c.data.put(EpisodeStore.DATA,saved);
        try{EpisodeStore.sync(c,new JSONArray().put(first).put(item("xin","https://evil.example/","Evil")).toString());throw new AssertionError("invalid snapshot accepted");}catch(IOException expected){}
        require(c.data.get(EpisodeStore.DATA).equals(saved),"invalid snapshot leaves entire prior state unchanged");
        System.out.println("PASS duplicate memberships, persistence, errors, settings, removal/re-addition, stale and concurrent workers, corrupt input");
    }
    static String zipText(ZipFile zip,String name)throws Exception{return new String(zip.getInputStream(zip.getEntry(name)).readAllBytes(),StandardCharsets.UTF_8);}
    static void realSnapshots() throws Exception {
        String path=System.getenv("MOKU_SNAPSHOT_ZIP");if(path==null)return;
        try(ZipFile zip=new ZipFile(path)) {
            String[][] cases={
                {"suge","https://animesuge.cz/anime/road-of-naruto-ggjw8","suge-detail.html","suge-episodes.json","1"},
                {"anikoto","https://anikototv.to/watch/naruto-eybxz","anikoto-detail.html","anikoto-episodes.json","220"},
                {"rulz","https://animerulz.com.in/anime/naruto/","rulz-detail.html","","220"},
                {"waves","https://aniwaves.ru/watch/naruto-76396","waves-detail.html","waves-episodes.json","220"},
                {"narul","https://naruldonghua.com/soul-land-2-the-unrivaled-tang-sect/","narul-detail.html","","176"},
                // The captured site labels two distinct links as episode 142; monitor that number once.
                {"stream","https://donghuastream.org/anime/soul-land-2nd/","stream-detail.html","","176"},
                {"world","https://donghuaworld.com/anime/soul-land-2-the-unrivaled-tang-sect-3d/","world-detail.html","","112"}
            };
            for(String[] row:cases){
                EpisodeFetcher.TextSource source=u->u.contains("/ajax/episode/list/")?zipText(zip,row[3]):zipText(zip,row[2]);
                List<EpisodeFetcher.Episode> list=EpisodeFetcher.fetch(row[0],row[1],source);
                require(list.size()==Integer.parseInt(row[4]),row[0]+" captured source count expected "+row[4]+" got "+list.size());
                System.out.println("PASS captured "+row[0]+" episode list: "+list.size());
            }
            EpisodeFetcher.TextSource bash=u->zipText(zip,u.contains("/api/watch/")?"bash-api-watch.json":"bash-api-anime.json");
            List<EpisodeFetcher.Episode> episodes=EpisodeFetcher.fetch("bash","https://animebash.in/anime/195516",bash);
            require(episodes.size()==5,"captured Bash watch list has five aired episodes, not the metadata total 12");System.out.println("PASS captured bash episode list: "+episodes.size());
        }
        String research=System.getenv("MOKU_RESEARCH_DIR");if(research!=null){
            String html=Files.readString(Paths.get(research,"v8/sogo-detail.html")),json=Files.readString(Paths.get(research,"sogo-episodes.json"));
            List<EpisodeFetcher.Episode> sogo=EpisodeFetcher.fetch("sogo","https://animesogo.to/watch/sample",u->u.contains("/ajax/")?json:html);
            require(!sogo.isEmpty(),"captured Sogo episodes");System.out.println("PASS captured sogo episode list: "+sogo.size());
            String xin=Files.readString(Paths.get(research,"v8/xin-detail.html"));
            List<EpisodeFetcher.Episode> xinEps=EpisodeFetcher.fetch("xin","https://animexin.dev/anime/sample/",u->xin);
            require(!xinEps.isEmpty(),"captured AnimeXin episodes");System.out.println("PASS captured xin episode list: "+xinEps.size());
        }
    }
    public static void main(String[] args)throws Exception{fixtureParsers();reducer();store();realSnapshots();System.out.println("ALL EPISODE UPDATE REGRESSIONS PASSED");}
}
