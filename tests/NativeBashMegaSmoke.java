package app.moku.anime;
/** Verifies an AnimeBash-linked MegaPlay embed even if the source API is temporarily blocked. */
public class NativeBashMegaSmoke {
    public static void main(String[] args) throws Exception {
        VideoResolver.Result r=VideoResolver.megaPlay("https://megaplay.buzz/stream/mal/20/1/sub");
        if(!SafeHttp.text(r.url,r.referer,2097152).contains("#EXTM3U"))throw new AssertionError("not HLS");
        System.out.println("AnimeBash-linked MegaPlay: HLS, " + VideoResolver.subtitleTracksForDownload(r,"bash").size() + " English subtitle tracks");
    }
}
