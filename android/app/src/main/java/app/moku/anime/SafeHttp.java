package app.moku.anime;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Bounded, HTTPS-only requests used by the offline resolver, never exposed to remote JavaScript. */
final class SafeHttp {
    private SafeHttp() {}
    static URL publicUrl(String raw) throws IOException {
        if (!Network.isHttps(raw)) throw new IOException("Unsupported video URL");
        URL u = new URL(raw);
        String h = u.getHost().toLowerCase(Locale.ROOT);
        if (!h.contains(".") || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".home.arpa"))
            throw new IOException("Private video host is not allowed");
        for (InetAddress a : InetAddress.getAllByName(h)) requirePublicAddress(a);
        return u;
    }
    static void requirePublicAddress(InetAddress a) throws IOException {
        byte[] b=a.getAddress();
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress() || a.isMulticastAddress())
            throw new IOException("Private video host is not allowed");
        if (b.length==4) {
            int x=b[0]&255,y=b[1]&255;
            if(x==0||x==10||x==127||x>=224||(x==100&&y>=64&&y<=127)||(x==169&&y==254)
                ||(x==172&&y>=16&&y<=31)||(x==192&&y==168)||(x==198&&(y==18||y==19)))
                throw new IOException("Private video host is not allowed");
        } else if (b.length==16 && (b[0]&0xfe)==0xfc) throw new IOException("Private video host is not allowed");
    }
    static byte[] get(String raw, String referer, int limit) throws IOException {
        URL current=publicUrl(raw);
        for (int redirects=0; redirects<=5; redirects++) {
            HttpURLConnection c=(HttpURLConnection)current.openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000); c.setReadTimeout(25000);
            String host=current.getHost().toLowerCase(Locale.ROOT);
            // MediaFire's mobile HTML often points back to an interstitial instead of the file.
            String agent=(host.equals("mediafire.com")||host.equals("www.mediafire.com"))
                ? "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36" : Network.UA;
            c.setRequestProperty("User-Agent",agent);
            c.setRequestProperty("Accept","text/html,application/json,application/vnd.apple.mpegurl,text/vtt,*/*;q=0.8");
            c.setRequestProperty("Accept-Encoding","identity");
            c.setRequestProperty("X-Requested-With","XMLHttpRequest");
            if (referer!=null && Network.isHttps(referer)) {
                c.setRequestProperty("Referer",referer);
                URL origin=new URL(referer);
                c.setRequestProperty("Origin",origin.getProtocol()+"://"+origin.getHost());
            }
            int code=c.getResponseCode();
            if (code>=300 && code<400) {
                String location=c.getHeaderField("Location"); c.disconnect();
                if (location==null) throw new IOException("Invalid video-host redirect");
                current=publicUrl(new URL(current,location).toString()); continue;
            }
            if (code<200 || code>=300) { c.disconnect(); throw new IOException("Video host returned HTTP "+code); }
            try (InputStream in=c.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] bytes=new byte[16384]; int n,total=0;
                while ((n=in.read(bytes))!=-1) { total+=n; if (total>limit) throw new IOException("Video-host response is too large"); out.write(bytes,0,n); }
                return out.toByteArray();
            } finally { c.disconnect(); }
        }
        throw new IOException("Too many video-host redirects");
    }
    static String text(String url,String referer,int limit) throws IOException {
        return new String(get(url,referer,limit),StandardCharsets.UTF_8);
    }
}
