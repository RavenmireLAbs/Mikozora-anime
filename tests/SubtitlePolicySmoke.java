package app.moku.anime;

import java.util.List;

/** Deterministic policy and pre-fetch tests; no network or Android runtime required. */
public final class SubtitlePolicySmoke {
    private static void yes(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args) {
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
        yes(!SubtitlePolicy.keepTrack("sogo","fr","French")&&SubtitlePolicy.keepTrack("sogo","en","English"),"folder copies use the same policy");
        System.out.println("Subtitle policy passed: six Anime sources English-only before fetch; Donghua track handling is unchanged.");
    }
}
