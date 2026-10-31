package app.moku.anime;

/** Live on-device network implementation smoke test; run with scripts/test-native.sh. */
public class NativeNetworkSmoke {
    public static void main(String[] args) throws Exception {
        String home = Network.get("https://animesogo.to/home", true).text();
        if (!home.contains("AnimeSogo")) throw new AssertionError("AnimeSogo did not return its home page");
        String xin = Network.get("https://animexin.dev/?s=soul", true).text();
        if (!xin.contains("Soul")) throw new AssertionError("AnimeXin search failed");
        Network.Result image = Network.get("https://animexin.dev/wp-content/uploads/2023/06/Soul-Land-2-Tang-Sect-768x1077.jpg", false);
        if (!image.type.startsWith("image/") || image.data.length < 5000) throw new AssertionError("Image with source referer failed");
        try { Network.get("https://example.com/", true); throw new AssertionError("Unapproved host was accepted"); }
        catch (java.io.IOException expected) { }
        if (Network.isHttps("https://127.0.0.1/private") || Network.isHttps("http://example.com")) throw new AssertionError("Private or non-HTTPS player URL accepted");
        System.out.println("Native network smoke passed: AnimeSogo, AnimeXin, artwork and host restrictions.");
    }
}
