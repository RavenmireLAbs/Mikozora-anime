package app.moku.anime;

import java.net.URL;
import java.util.List;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.json.JSONObject;
import org.json.JSONArray;

/** Optional live test for newly integrated offline hosts. Uses real site data, never runs on-device in production. */
public class NativeMultiSourceSmoke {
    static void check(boolean v,String message){if(!v)throw new AssertionError(message);}
    public static void main(String[] args) throws Exception {
        String source=args[0], episodeUrl="", ids="";
        switch(source) {
            case "suge":
            case "anikoto": {
                String base=Network.sourceBase(source), id="suge".equals(source)?"7174":"958";
                JSONObject json=new JSONObject(Network.get(base+"/ajax/episode/list/"+id+"?vrf=",true).text());
                Document document=Jsoup.parse(json.getString("result"));Element first=document.selectFirst("a[data-ids][data-num]");
                check(first!=null,"episode data missing");ids=first.attr("data-ids");
                episodeUrl="suge".equals(source)?base+"/anime/road-of-naruto-ggjw8/ep-1":base+"/watch/naruto-eybxz/ep-1";break;
            }
            case "rulz":episodeUrl="https://animerulz.com.in/naruto-episode-1/";break;
            case "bash":episodeUrl="https://animebash.in/anime/20/1";break;
            case "narul":episodeUrl="https://naruldonghua.com/soul-land-2-the-peerless-tang-clan-episode-176-english-sub/";break;
            case "stream":episodeUrl="https://donghuastream.org/soul-land-2-the-peerless-tang-sect-episode-177-multiple-subtitles/";break;
            case "world":episodeUrl="https://donghuaworld.com/soul-land-2-the-unrivaled-tang-sect-3d-episode-177-4k-multi-subtitles/";break;
            case "waves":episodeUrl="https://aniwaves.ru/watch/76396/ep-1";ids="76396&eps=1";break;
            default:throw new IllegalArgumentException("unknown source");
        }
        JSONObject item=new JSONObject().put("source",source), ep=new JSONObject().put("url",episodeUrl).put("ids",ids);
        VideoResolver.Result result=VideoResolver.resolve(item,ep,"english");
        check(Network.isHttps(result.url),"invalid media");
        if("application/x-mpegURL".equalsIgnoreCase(result.mime))check(SafeHttp.text(result.url,result.referer,2*1024*1024).contains("#EXTM3U"),"invalid HLS");
        List<VideoResolver.Track> subtitles=VideoResolver.subtitleTracksForDownload(result,source);
        if(SubtitlePolicy.englishOnly(source))for(VideoResolver.Track track:subtitles)check(SubtitlePolicy.isEnglish(track.language,track.label),"non-English subtitle");
        JSONArray options=VideoResolver.downloadOptions(item,ep,"english").getJSONArray("servers");
        check(options.length()>0,"no working quality choices");
        check(options.getJSONObject(0).getJSONArray("qualities").length()>0,"no quality choices");
        System.out.println(source+": host="+result.host+" HLS/MP4 valid, english tracks="+subtitles.size()+", selectable servers="+options.length()+" first="+options.getJSONObject(0).getString("label"));
    }
}
