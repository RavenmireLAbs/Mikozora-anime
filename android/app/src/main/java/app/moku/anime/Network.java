package app.moku.anime;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** On-device HTTP access for the configured source websites and their artwork hosts. */
final class Network {
    static final String APP_HOST = "app.moku.local";
    static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
    // Source document hosts, plus api.github.com for the in-app update checker.
    private static final Set<String> DOCUMENT_HOSTS = new HashSet<>(Arrays.asList("animesogo.to", "animesuge.cz", "anikototv.to", "animerulz.com.in", "aniwaves.ru", "animebash.in", "animexin.dev", "naruldonghua.com", "donghuastream.org", "donghuaworld.com", "api.github.com"));
    private static final Set<String> IMAGE_HOSTS = new HashSet<>(Arrays.asList("animesogo.to", "animesuge.cz", "anikototv.to", "animerulz.com.in", "aniwaves.ru", "static.aniwaves.ru", "animebash.in", "animexin.dev", "naruldonghua.com", "donghuastream.org", "donghuaworld.com", "cdn.anipixcdn.co", "image.tmdb.org", "media.themoviedb.org", "s4.anilist.co", "s3.anilist.co"));
    private Network() {}
    static boolean allowedSource(String raw) {
        try { checkUrl(raw, true); return true; } catch (Exception ignored) { return false; }
    }
    // Exact host-to-source mapping is also used to validate offline selections.
    static String sourceBase(String source) {
        if(source==null)return "";
        switch(source) {
            case "sogo":return "https://animesogo.to";
            case "suge":return "https://animesuge.cz";
            case "anikoto":return "https://anikototv.to";
            case "rulz":return "https://animerulz.com.in";
            case "waves":return "https://aniwaves.ru";
            case "bash":return "https://animebash.in";
            case "xin":return "https://animexin.dev";
            case "narul":return "https://naruldonghua.com";
            case "stream":return "https://donghuastream.org";
            case "world":return "https://donghuaworld.com";
            default:return "";
        }
    }
    static boolean matchesSource(String source,String raw) {
        try {
            String base=sourceBase(source);
            if(base.isEmpty())return false;
            URL u=checkUrl(raw,true);
            return u.getHost().equalsIgnoreCase(new URL(base).getHost());
        } catch(Exception ignored){return false;}
    }
    static String sourceName(String source) {
        if(source==null)return "Source";
        switch(source) {
            case "sogo":return "AnimeSogo"; case "suge":return "AnimeSuge";
            case "anikoto":return "Anikoto"; case "rulz":return "Animerulz";
            case "waves":return "Aniwaves"; case "bash":return "AnimeBash";
            case "xin":return "AnimeXin"; case "narul":return "NarulDonghua";
            case "stream":return "DonghuaStream"; case "world":return "DonghuaWorld";
            default:return "Source";
        }
    }
    static boolean isHttps(String raw) {
        try { URL u = new URL(raw); String host = u.getHost().toLowerCase(); return "https".equalsIgnoreCase(u.getProtocol()) && u.getUserInfo() == null && (u.getPort() == -1 || u.getPort() == 443) && !host.isEmpty() && !host.equals("localhost") && !host.endsWith(".localhost") && !host.endsWith(".local") && host.contains(".") && !host.matches("[0-9.]+") && !host.contains(":"); }
        catch (Exception ignored) { return false; }
    }
    private static URL checkUrl(String raw, boolean document) throws IOException {
        URL u;
        try { u = new URL(raw); } catch (Exception e) { throw new IOException("Invalid source URL"); }
        if (!"https".equalsIgnoreCase(u.getProtocol()) || u.getUserInfo() != null || (u.getPort() != -1 && u.getPort() != 443)
                || !(document ? DOCUMENT_HOSTS : IMAGE_HOSTS).contains(u.getHost().toLowerCase())) {
            throw new IOException("Unsupported source host");
        }
        return u;
    }
    static final class Result {
        final byte[] data; final String type;
        Result(byte[] data, String type) { this.data = data; this.type = type; }
        String text() { return new String(data, StandardCharsets.UTF_8); }
    }
    static Result get(String raw, boolean document) throws IOException {
        return get(raw, document, 20000, 25000);
    }
    // Shorter source-list timeouts keep background checks bounded; existing
    // catalog, playback, artwork and download requests keep their old limits.
    static Result getEpisodeList(String raw) throws IOException {
        return get(raw, true, 12000, 15000);
    }
    private static Result get(String raw, boolean document, int connectTimeout, int readTimeout) throws IOException {
        URL current = checkUrl(raw, document);
        for (int redirects = 0; redirects <= 4; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setConnectTimeout(connectTimeout);
            connection.setReadTimeout(readTimeout);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", UA);
            String host=current.getHost().toLowerCase();
            String referer=DOCUMENT_HOSTS.contains(host)?"https://"+host+"/":
                host.equals("static.aniwaves.ru")?"https://aniwaves.ru/":"https://animesogo.to/";
            connection.setRequestProperty("Referer", referer);
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Accept", document ? "text/html,application/json,*/*;q=0.8" : "image/avif,image/webp,image/apng,image/*,*/*;q=0.8");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IOException("Source returned an invalid redirect");
                current = checkUrl(new URL(current, location).toString(), document);
                continue;
            }
            if (code < 200 || code >= 300) { connection.disconnect(); throw new IOException("Source returned HTTP " + code); }
            String type = connection.getContentType();
            if (type == null) type = document ? "text/plain" : "application/octet-stream";
            if (!document && !type.toLowerCase().startsWith("image/")) { connection.disconnect(); throw new IOException("Source did not return an image"); }
            int limit = document ? 5 * 1024 * 1024 : 8 * 1024 * 1024;
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16384]; int count; int total = 0;
                while ((count = in.read(buffer)) != -1) {
                    total += count;
                    if (total > limit) throw new IOException("Source response is too large");
                    out.write(buffer, 0, count);
                }
                return new Result(out.toByteArray(), type.split(";")[0]);
            } finally { connection.disconnect(); }
        }
        throw new IOException("Too many redirects");
    }
}
