package app.moku.anime;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.json.JSONObject;
import org.json.JSONArray;

/** Host-JVM test of the actual resolver, its HLS manifest, MP4 headers, and subtitle tracks. */
public class NativeDownloadResolverSmoke {
    static void check(boolean v,String what){if(!v)throw new AssertionError(what);}
    public static void main(String[] args) throws Exception {
        JSONArray fixture=VideoResolver.hlsQualities("#EXTM3U\n#EXT-X-I-FRAME-STREAM-INF:RESOLUTION=3840x2160\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\na.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x820,BANDWIDTH=3\nb.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=640x360\nc.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nd.m3u8\n");
        check(fixture.length()==2,"quality list deduplicates resolutions and excludes iframe/no-resolution tracks");
        check("v:1920x820".equals(fixture.getJSONObject(0).getString("id")) && "v:640x360".equals(fixture.getJSONObject(1).getString("id")),"quality list retains real dimensions and sorts descending");
        try { VideoResolver.validateSelection("sogo-invalid/../../x","best");throw new AssertionError("invalid server accepted"); }catch(java.io.IOException expected){}
        try { VideoResolver.validateSelection("auto","v:bad");throw new AssertionError("invalid quality accepted"); }catch(java.io.IOException expected){}
        check(!Network.isHttps("https://127.0.0.1/private"),"numeric local URL rejected");
        try{SafeHttp.publicUrl("https://localtest.me/test");throw new AssertionError("loopback DNS accepted");}catch(java.io.IOException expected){}
        String source="https://animesogo.to/watch/one-piece-odmau";
        Document page=Jsoup.parse(Network.get(source,true).text());String pageId=page.selectFirst("#watch-page").attr("data-id");
        JSONObject json=new JSONObject(Network.get("https://animesogo.to/ajax/episode/list/"+pageId+"?vrf=",true).text());
        Document eps=Jsoup.parse(json.getString("result"));Element first=eps.selectFirst("ul.episodes > li > a[data-ids]");
        JSONObject item=new JSONObject().put("source","sogo").put("url",source).put("title","One Piece");
        JSONObject ep=new JSONObject().put("url",source+"/ep-"+first.attr("data-num")).put("ids",first.attr("data-ids"));
        VideoResolver.Result mega=VideoResolver.resolve(item,ep,"english");
        for(VideoResolver.Track track:VideoResolver.subtitleTracksForDownload(mega,"sogo"))
            check(SubtitlePolicy.isEnglish(track.language,track.label),"only English sidecars are selected for fetching");
        check(mega.url.contains(".m3u8")&&"MegaPlay".equals(mega.host),"MegaPlay resolver");
        String master=SafeHttp.text(mega.url,mega.referer,2*1024*1024);check(master.startsWith("#EXTM3U"),"MegaPlay HLS master");
        VideoResolver.Track english=mega.tracks.stream().filter(t->"en".equals(t.language)).findFirst().orElseThrow(()->new AssertionError("English subtitle track absent"));
        String subs=SafeHttp.text(english.url,mega.referer,2*1024*1024);check(subs.contains("WEBVTT")&&subs.contains("-->"),"real MegaPlay English WebVTT");
        String variant=null;for(String line:master.split("\\n")){line=line.trim();if(!line.isEmpty()&&!line.startsWith("#")){variant=new URL(new URL(mega.url),line).toString();break;}}
        check(variant!=null,"HLS rendition");String media=SafeHttp.text(variant,mega.referer,2*1024*1024);check(media.contains("#EXTINF"),"HLS media playlist");
        String segment=null;for(String line:media.split("\\n")){line=line.trim();if(!line.isEmpty()&&!line.startsWith("#")){segment=new URL(new URL(variant),line).toString();break;}}
        check(segment!=null,"HLS segment listed");byte[] video=SafeHttp.get(segment,mega.referer,8*1024*1024);check(video.length>10000,"real HLS segment bytes");
        System.out.println("AnimeSogo: MegaPlay HLS, segment bytes="+video.length+", subtitle tracks="+mega.tracks.size()+", English WebVTT="+subs.length());
        org.jsoup.select.Elements all=eps.select("ul.episodes > li > a[data-ids]");Element latest=all.get(all.size()-1);
        JSONObject recent=new JSONObject().put("url",source+"/ep-"+latest.attr("data-num")).put("ids",latest.attr("data-ids"));
        JSONObject sogoOptions=VideoResolver.downloadOptions(item,recent,"english");JSONArray sogoServers=sogoOptions.getJSONArray("servers");
        check(sogoServers.length()>=2,"separate AnimeSogo server choices discovered");
        JSONObject selectedServer=sogoServers.getJSONObject(0);JSONArray available=selectedServer.getJSONArray("qualities");
        check(available.length()>=2,"actual HLS resolutions discovered");
        String chosenId=selectedServer.getString("id"), chosenQuality=available.getJSONObject(1).getString("id");
        VideoResolver.Result explicit=VideoResolver.resolve(item,recent,"english",chosenId,chosenQuality);
        check("MegaPlay".equals(explicit.host)&&chosenQuality.startsWith("v:"),"chosen AnimeSogo server resolves independently");
        try {VideoResolver.resolve(item,recent,"english","sogo-not-listed-0","best");throw new AssertionError("missing server silently switched");}catch(java.io.IOException expected){check(expected.getMessage().contains("not available"),"missing server error");}
        try {VideoResolver.resolve(item,recent,"english",chosenId,"f:1080");throw new AssertionError("wrong quality format accepted");}catch(java.io.IOException expected){}
        try {VideoResolver.resolve(new JSONObject().put("source","xin"),recent,"english");throw new AssertionError("mismatched source accepted");}catch(java.io.IOException expected){}
        System.out.println("AnimeSogo options: "+sogoServers.length()+" servers; "+available.length()+" choices on "+chosenId);


        String xin="https://animexin.dev/soul-land-2-the-peerless-tang-sect-episode-177-indonesia-english-sub/";
        VideoResolver.Result x=VideoResolver.resolve(new JSONObject().put("source","xin"),new JSONObject().put("url",xin),"english");
        check("MediaFire".equals(x.host)||"Dailymotion".equals(x.host)||"OK.ru".equals(x.host),"AnimeXin supported host");
        check(x.subtitleDescription.toLowerCase().contains("english"),"AnimeXin requested hardsub language");
        if("MediaFire".equals(x.host)||"OK.ru".equals(x.host)) {
            URL u=SafeHttp.publicUrl(x.url);HttpURLConnection c=(HttpURLConnection)u.openConnection();c.setConnectTimeout(20000);c.setReadTimeout(20000);
            c.setRequestProperty("User-Agent",Network.UA);c.setRequestProperty("Referer",x.referer);c.setRequestProperty("Range","bytes=0-1023");
            int status=c.getResponseCode();check(status==200||status==206,"progressive host HTTP range");byte[] b=new byte[64];int n=c.getInputStream().read(b);c.disconnect();
            check(n>=12&&new String(b,4,4,StandardCharsets.US_ASCII).equals("ftyp"),"progressive host is an actual MP4, not HTML");
            System.out.println("AnimeXin: real "+x.host+" MP4 bytes, English burned-in subtitles");
        }else check(SafeHttp.text(x.url,x.referer,2*1024*1024).contains("#EXTM3U"),"Dailymotion HLS");
        VideoResolver.Result dm=VideoResolver.dailyMotion("https://geo.dailymotion.com/player/xhojl.html?video=k198yQtWpfaVQkMdUNU");
        String dmMaster=SafeHttp.text(dm.url,dm.referer,2*1024*1024);check(dmMaster.contains("#EXTM3U")&&dmMaster.contains("#EXT-X-MEDIA:TYPE=AUDIO"),"Dailymotion separate audio HLS");
        JSONObject xinItem=new JSONObject().put("source","xin"),xinEpisode=new JSONObject().put("url",xin);
        JSONArray xinServers=VideoResolver.downloadOptions(xinItem,xinEpisode,"english").getJSONArray("servers");
        check(xinServers.length()>=2,"different AnimeXin server choices discovered");boolean gotFile=false,gotOther=false;
        for(int n=0;n<xinServers.length();n++) {
            JSONObject option=xinServers.getJSONObject(n);String server=option.getString("id");JSONArray qualities=option.getJSONArray("qualities");
            String quality=qualities.length()>1?qualities.getJSONObject(1).getString("id"):"best";
            VideoResolver.Result chosen=VideoResolver.resolve(xinItem,xinEpisode,"english",server,quality);
            check(chosen.subtitleDescription.contains("English"),"selected server retains subtitle language");
            if("MediaFire".equals(chosen.host)){gotFile=true;check(qualities.length()>1&&quality.startsWith("f:"),"source-labeled MediaFire quality");
                try{VideoResolver.resolve(xinItem,xinEpisode,"english",server,"f:4320");throw new AssertionError("unavailable file quality silently switched");}catch(java.io.IOException expected){}
            } else if("Dailymotion".equals(chosen.host)) {
                gotOther=true;check(SafeHttp.text(chosen.url,chosen.referer,2*1024*1024).contains("#EXTM3U"),"chosen Dailymotion HLS");
            } else if("OK.ru".equals(chosen.host)) {
                gotOther=true;URL fileUrl=SafeHttp.publicUrl(chosen.url);HttpURLConnection c=(HttpURLConnection)fileUrl.openConnection();
                c.setConnectTimeout(20000);c.setReadTimeout(20000);c.setRequestProperty("User-Agent",Network.UA);c.setRequestProperty("Referer",chosen.referer);c.setRequestProperty("Range","bytes=0-63");
                check(c.getResponseCode()==206,"OK.ru supports byte ranges");byte[] b=new byte[16];int read=c.getInputStream().read(b);c.disconnect();
                check(read>=12&&new String(b,4,4,StandardCharsets.US_ASCII).equals("ftyp"),"OK.ru delivers MP4 bytes");
            }
        }
        check(gotFile&&gotOther,"MediaFire plus another independently selected server resolve");
        System.out.println("AnimeXin options: "+xinServers.length()+" supported servers; explicit quality and subtitle checks passed.");
        System.out.println("Dailymotion: HLS master and audio rendition available; resolver smoke passed.");
    }
}
