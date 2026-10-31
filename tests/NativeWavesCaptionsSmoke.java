package app.moku.anime;
import org.json.JSONObject;
/** Live test: Aniwaves EchoVideo subtitle selection is restricted to identified English tracks. */
public class NativeWavesCaptionsSmoke {
    public static void main(String[] args) throws Exception {
        JSONObject item=new JSONObject().put("source","waves");
        JSONObject ep=new JSONObject().put("url","https://aniwaves.ru/watch/82761/ep-1").put("ids","82761&eps=1");
        VideoResolver.Result r=VideoResolver.resolve(item,ep,"english");
        java.util.List<VideoResolver.Track> selected=VideoResolver.subtitleTracksForDownload(r,"waves");
        if(selected.isEmpty())throw new AssertionError("No English tracks from EchoVideo");
        for(VideoResolver.Track t:selected)if(!SubtitlePolicy.isEnglish(t.language,t.label))throw new AssertionError("Non-English track accepted");
        String first=SafeHttp.text(selected.get(0).url,r.referer,2*1024*1024);
        if(!first.contains("WEBVTT"))throw new AssertionError("English subtitle is not WebVTT");
        if(!SafeHttp.text(r.url,r.referer,2*1024*1024).contains("#EXTM3U"))throw new AssertionError("Missing HLS");
        System.out.println("Aniwaves EchoVideo: HLS and " + selected.size() + " English WebVTT track(s); " + r.tracks.size() + " tracks offered by server.");
    }
}
