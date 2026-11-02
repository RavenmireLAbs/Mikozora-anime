package app.moku.anime;

import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Deterministic policy and pre-fetch tests; no network or Android runtime required. */
public final class SubtitlePolicySmoke {
    private static void yes(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args) throws Exception {
        for(String source:new String[]{"sogo","suge","anikoto","rulz","waves","bash"}) {
            yes(SubtitlePolicy.englishOnly(source),source+" is English-only");
            yes("english".equals(SubtitlePolicy.languageFor(source,"indonesian")),source+" language is normalized");
        }
        for(String source:new String[]{"xin","narul","stream","world"})
            yes(!SubtitlePolicy.englishOnly(source),source+" retains the subtitle choice");
        yes(!SubtitlePolicy.englishOnly("xin"),"AnimeXin is not forced to English");
        yes("english".equals(SubtitlePolicy.languageFor("sogo","indonesian")),"old or direct Sogo requests are normalized");
        yes("indonesian".equals(SubtitlePolicy.languageFor("xin","indonesian")),"AnimeXin choice is preserved");
        for(String code:new String[]{"en","EN-us","en_US","eng","eng-GB","English"})
            yes(SubtitlePolicy.isEnglish(code,""),"English tag: "+code);
        for(String label:new String[]{"English", "English (CR English)","CR English", "ENG - SDH", "en-US (CC)"})
            yes(SubtitlePolicy.isEnglish("und",label),"English label: "+label);
        for(String code:new String[]{"fr","ar","id","es","pt-BR","ja"})
            yes(!SubtitlePolicy.isEnglish(code,"English"),"Explicit non-English tag wins: "+code);
        for(String label:new String[]{"French", "Arabic", "Indonesian", "unknown", "Non-English", ""})
            yes(!SubtitlePolicy.isEnglish("und",label),"Non-English/unknown label: "+label);
        VideoResolver.Result result=new VideoResolver.Result();
        result.tracks.add(new VideoResolver.Track("https://test.invalid/fr.vtt","French","fr","text/vtt",true));
        result.tracks.add(new VideoResolver.Track("https://test.invalid/en.vtt","English","en","text/vtt",false));
        result.tracks.add(new VideoResolver.Track("https://test.invalid/ar.vtt","Arabic","ar","text/vtt",false));
        result.tracks.add(new VideoResolver.Track("https://test.invalid/en-cc.vtt","English SDH","en-US","text/vtt",false));
        result.tracks.add(new VideoResolver.Track("https://test.invalid/und.vtt","Unknown","und","text/vtt",false));
        for(String source:new String[]{"sogo","suge","anikoto","rulz","waves","bash"}) {
            List<VideoResolver.Track> selected=VideoResolver.subtitleTracksForDownload(result,source);
            yes(selected.size()==2&&selected.get(0).url.endsWith("/en.vtt")&&selected.get(1).url.endsWith("/en-cc.vtt"),source+": only English URLs are passed to fetch");
        }
        for(String source:new String[]{"xin","narul","stream","world"})
            yes(VideoResolver.subtitleTracksForDownload(result,source).size()==5,source+" track behavior is preserved");
        yes(!SubtitlePolicy.keepTrack("sogo","fr","French")&&SubtitlePolicy.keepTrack("sogo","en","English"),"automatic folder copies use the same policy");
        yes("ar".equals(SubtitlePolicy.languageCode("Arabic","العربية")),"full language names normalize to codes");
        yes(SubtitlePolicy.trackId("en","English (SDH)").equals(SubtitlePolicy.trackId("en","English - SDH")),"track IDs ignore punctuation-only label changes");
        JSONObject french=SubtitlePolicy.trackOption("fr","French",false,false);
        JSONObject customInput=new JSONObject().put("subtitleMode","custom")
            .put("subtitleTracks",new JSONArray().put(new JSONObject().put("id",french.getString("id")).put("label","French").put("language","fr")));
        SubtitlePolicy.Selection custom=SubtitlePolicy.selectionFromInput(customInput,"sogo-server-0");
        List<VideoResolver.Track> customTracks=VideoResolver.subtitleTracksForDownload(result,"sogo",custom);
        yes(customTracks.size()==1&&customTracks.get(0).url.endsWith("/fr.vtt"),"explicit Sogo selection can choose French before fetch");
        yes(SubtitlePolicy.keepForSelection("sogo",custom,"fr","French")&&!SubtitlePolicy.keepForSelection("sogo",custom,"en","English"),"folder copies keep the explicit selection");
        SubtitlePolicy.Selection none=SubtitlePolicy.selectionFromInput(new JSONObject().put("subtitleMode","none"),"auto");
        yes(VideoResolver.subtitleTracksForDownload(result,"sogo",none).isEmpty(),"no separate subtitles can be selected");
        boolean autoRejected=false;
        try{SubtitlePolicy.selectionFromInput(customInput,"auto");}catch(Exception expected){autoRejected=true;}
        yes(autoRejected,"track-level choices require the server that reported them");
        JSONArray hlsOptions=VideoResolver.hlsSubtitleOptions("#EXTM3U\n"
            +"#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"French\",LANGUAGE=\"fr\",URI=\"fr.m3u8\"\n"
            +"#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",NAME=\"English\",LANGUAGE=\"en\",URI=\"en.m3u8\"\n"
            +"#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"other\",NAME=\"Arabic\",LANGUAGE=\"ar\",URI=\"ar.m3u8\"\n"
            +"#EXT-X-STREAM-INF:BANDWIDTH=1,SUBTITLES=\"subs\"\nvideo.m3u8\n","sogo");
        yes(hlsOptions.length()==2&&"fr".equals(hlsOptions.getJSONObject(0).getString("language"))
            &&!hlsOptions.getJSONObject(0).getBoolean("defaultSelected")&&hlsOptions.getJSONObject(1).getBoolean("defaultSelected"),
            "HLS options list linked tracks with English as the automatic default");
        System.out.println("Subtitle policy passed: automatic English defaults, explicit server track selection, and no-subtitle mode.");
    }
}
