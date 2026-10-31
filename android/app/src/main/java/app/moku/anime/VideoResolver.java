package app.moku.anime;

import android.util.Base64;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Resolves only specific source hosts that actually publish a downloadable media URL. */
final class VideoResolver {
    static final class Track {
        final String url, label, language, mime;
        final boolean preferred;
        Track(String url,String label,String language,String mime,boolean preferred) {
            this.url=url;this.label=label;this.language=language;this.mime=mime;this.preferred=preferred;
        }
    }
    static final class Result {
        String url, mime, referer, host, serverLabel, subtitleDescription;
        int fixedHeight = -1;
        final List<Track> tracks = new ArrayList<>();
        final List<FileChoice> files = new ArrayList<>();
    }
    static final class FileChoice {
        final String url;
        final int height;
        FileChoice(String url,int height) { this.url=url; this.height=height; }
    }
    private static final class Candidate {
        final String id, label, provider, reference, source;
        final List<FileChoice> files = new ArrayList<>();
        Candidate(String id,String label,String provider,String reference) { this(id,label,provider,reference,""); }
        Candidate(String id,String label,String provider,String reference,String source) {
            this.id=id;this.label=label;this.provider=provider;this.reference=reference;this.source=source;
        }
    }
    private VideoResolver() {}
    /** Filter before fetching: AnimeSogo should never request non-English subtitle files. */
    static List<Track> subtitleTracksForDownload(Result result,String source) {
        List<Track> chosen=new ArrayList<>();
        for(Track t:result.tracks)if(SubtitlePolicy.keepTrack(source,t.language,t.label))chosen.add(t);
        return chosen;
    }
    private static String q(String s) throws Exception { return URLEncoder.encode(s,"UTF-8"); }
    private static boolean hostIs(String raw,String host) {
        try { return Network.isHttps(raw) && new URL(raw).getHost().equalsIgnoreCase(host); }
        catch (Exception ignored) { return false; }
    }
    private static String htmlAttr(Element e,String name) { return e==null ? "" : e.attr(name); }
    static Result resolve(JSONObject item,JSONObject episode,String language) throws Exception {
        return resolve(item,episode,language,"auto","best");
    }
    static Result resolve(JSONObject item,JSONObject episode,String language,String server,String quality) throws Exception {
        validateSelection(server,quality);
        if ("auto".equals(server) && !"best".equals(quality))
            throw new IOException("Choose a server before selecting a specific quality");
        List<Candidate> candidates=candidates(item,episode,language);
        String last="";boolean found=false;
        for (Candidate candidate:candidates) {
            if(!"auto".equals(server) && !candidate.id.equals(server))continue;
            found=true;
            try {
                Result result=resolveCandidate(candidate,quality);
                if("xin".equals(item.optString("source")))result.subtitleDescription="indonesian".equals(language)?"Indonesian subtitles burned in":"English subtitles burned in";
                return result;
            } catch(Exception e) {
                if(!"auto".equals(server))throw e;
                last=e.getMessage()==null?"":e.getMessage();
            }
        }
        if(!"auto".equals(server) && !found)
            throw new IOException("The chosen server is not available for this episode");
        throw new IOException(last.isEmpty()?"No supported download server was available":"No supported server could be resolved: "+last);
    }
    static void validateSelection(String server,String quality) throws IOException {
        if(server==null || !server.matches("(?:auto|(?:sogo|suge|anikoto|rulz|waves|bash|xin|narul|stream|world)-[a-z0-9-]{1,90})"))
            throw new IOException("Invalid download server");
        if(quality==null || !quality.matches("(?:best|v:[0-9]{2,5}x[0-9]{2,5}|f:[0-9]{3,4})"))
            throw new IOException("Invalid download quality");
    }
    private static List<Candidate> candidates(JSONObject item,JSONObject episode,String language) throws Exception {
        String source=item.optString("source"), episodeUrl=episode.optString("url");
        if (!Network.allowedSource(episodeUrl)) throw new IOException("Episode URL is not a configured source");
        if(!Network.matchesSource(source,episodeUrl))throw new IOException("Episode source does not match its URL");
        if ("sogo".equals(source) || "suge".equals(source) || "anikoto".equals(source)) return sogoCandidates(episode,source);
        if ("xin".equals(source)) return xinCandidates(episode,language);
        if ("bash".equals(source)) return bashCandidates(episode);
        if ("rulz".equals(source)||"narul".equals(source)||"stream".equals(source)||"world".equals(source)) return wordpressCandidates(episode,source,language);
        if ("waves".equals(source)) return wavesCandidates(episode);
        throw new IOException("Episode source does not match its URL");
    }
    private static String slug(String label) {
        String s=label.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+","-").replaceAll("^-|-$","");
        if(s.isEmpty())s="server";return s.length()>42?s.substring(0,42):s;
    }
    private static String stableId(String prefix,String label,Map<String,Integer> counts) {
        String base=prefix+"-"+slug(label);int n=counts.containsKey(base)?counts.get(base):0;
        counts.put(base,n+1);return base+"-"+n;
    }
    private static List<Candidate> sogoCandidates(JSONObject episode,String source) throws Exception {
        String ids=episode.optString("ids");
        if(ids.isEmpty() || ids.length()>1000)throw new IOException(Network.sourceName(source)+" did not provide server information");
        String base=Network.sourceBase(source);
        JSONObject list=new JSONObject(Network.get(base+"/ajax/server/list?servers="+q(ids),true).text());
        Document d=Jsoup.parse(list.optString("result"));List<Candidate> out=new ArrayList<>();
        Map<String,Integer> counts=new HashMap<>();
        for(Element group:d.select(".type")) {
            if(!"sub".equalsIgnoreCase(group.attr("data-type")))continue;
            for(Element a:group.select("[data-link-id]")) {
                if(out.size()>=12)break;
                String id=a.attr("data-link-id"),label=a.selectFirst("span")!=null?a.selectFirst("span").text():a.text();
                if(id.isEmpty()||id.length()>1000)continue;
                if(label.trim().isEmpty())label="Server";
                out.add(new Candidate(stableId(source,label,counts),label.trim(),"megaplay",id,source));
            }
        }
        if(out.isEmpty())throw new IOException("No subtitled "+Network.sourceName(source)+" server was listed");
        return out;
    }
    private static Result resolveCandidate(Candidate c,String quality) throws Exception {
        Result r;
        switch(c.provider) {
            case "megaplay": {
                if(quality.startsWith("f:"))throw new IOException("This server does not provide that file quality");
                String base=Network.sourceBase(c.source);
                if(base.isEmpty())throw new IOException("Unsupported source");
                JSONObject server=new JSONObject(Network.get(base+"/ajax/server?get="+q(c.reference),true).text());
                JSONObject data=server.optJSONObject("result");String embed=data==null?"":data.optString("url");
                if(!hostIs(embed,"megaplay.buzz")||!new URL(embed).getPath().contains("/stream/"))
                    throw new IOException("This server is not a supported MegaPlay mirror");
                r=megaPlay(embed,base+"/");break;
            }
            case "echo": {
                if(quality.startsWith("f:"))throw new IOException("This server does not provide that file quality");
                JSONObject info=new JSONObject(Network.get(Network.sourceBase("waves")+"/ajax/sources?id="+q(c.reference)+"&asi=0&autoPlay=0",true).text());
                JSONObject data=info.optJSONObject("result");String embed=data==null?"":data.optString("url");
                r=echoVideo(embed);break;
            }
            case "direct-mega": {
                if(quality.startsWith("f:"))throw new IOException("This server does not provide that file quality");
                if(!hostIs(c.reference,"megaplay.buzz")||!new URL(c.reference).getPath().contains("/stream/"))throw new IOException("Unsupported MegaPlay mirror");
                r=megaPlay(c.reference,Network.sourceBase(c.source)+"/");break;
            }
            case "gogomega": {
                if(quality.startsWith("f:"))throw new IOException("This server does not provide that file quality");
                if(!hostIs(c.reference,"gogoanime.com.by"))throw new IOException("Unsupported GogoAnime mirror");
                String page=SafeHttp.text(c.reference,Network.sourceBase(c.source)+"/",2*1024*1024);
                Document wrapper=Jsoup.parse(page,c.reference);Element frame=wrapper.selectFirst("iframe[src]");
                String embed=frame==null?"":frame.absUrl("src");
                if(!hostIs(embed,"megaplay.buzz")||!new URL(embed).getPath().contains("/stream/"))throw new IOException("This server did not return a supported video");
                r=megaPlay(embed,c.reference);break;
            }
            case "mediafire": {
                FileChoice choice=chooseFile(c.files,quality);
                String html=SafeHttp.text(choice.url,"https://animexin.dev/",3*1024*1024);
                String file=mediafireFile(html,choice.url);
                if(file.isEmpty())throw new IOException("MediaFire did not return a supported video file");
                r=new Result();r.url=file;r.mime="";r.host="MediaFire";r.referer="https://www.mediafire.com/";
                r.fixedHeight=choice.height;r.files.addAll(c.files);break;
            }
            case "dailymotion": {
                if(quality.startsWith("f:"))throw new IOException("This server does not provide that file quality");
                r=dailyMotion(c.reference);break;
            }
            case "okru": r=okru(c.reference,quality);break;
            default: throw new IOException("Unsupported download server");
        }
        r.serverLabel=c.label;
        if("xin".equals(c.source) || c.source.isEmpty()) {
            if(!"megaplay".equals(c.provider))r.subtitleDescription=c.label.toLowerCase(Locale.ROOT).contains("indonesia")?"Indonesian subtitles burned in":"English subtitles burned in";
        } else if("dailymotion".equals(c.provider)||"okru".equals(c.provider)||"mediafire".equals(c.provider)) {
            r.subtitleDescription="Subtitle availability depends on the selected server";
        }
        return r;
    }
    /** Finds server and quality choices for one representative episode. No expiring URL is sent to the UI. */
    static JSONObject downloadOptions(JSONObject item,JSONObject episode,String language) throws Exception {
        List<Candidate> candidates=candidates(item,episode,language);
        ExecutorService pool=Executors.newFixedThreadPool(Math.min(3,Math.max(1,candidates.size())));
        List<Future<JSONObject>> futures=new ArrayList<>();
        int count=Math.min(8,candidates.size());
        for(int i=0;i<count;i++) {final Candidate c=candidates.get(i);futures.add(pool.submit(()->probeCandidate(c)));}
        JSONArray servers=new JSONArray();int failed=0;long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(50);
        try {
            for(Future<JSONObject> future:futures) {
                long remain=deadline-System.nanoTime();
                if(remain<=0){failed++;future.cancel(true);continue;}
                try { JSONObject value=future.get(remain,TimeUnit.NANOSECONDS);if(value!=null)servers.put(value);else failed++; }
                catch(Exception ignored){failed++;future.cancel(true);}
            }
        } finally {for(Future<JSONObject> future:futures)if(!future.isDone())future.cancel(true);pool.shutdownNow();}
        return new JSONObject().put("servers",servers).put("unavailable",failed);
    }
    private static JSONObject probeCandidate(Candidate c) throws Exception {
        Result r=resolveCandidate(c,"best");JSONArray qualities=new JSONArray();
        qualities.put(new JSONObject().put("id","best").put("label","Best available"));
        boolean hls="application/x-mpegURL".equalsIgnoreCase(r.mime);
        String note="";
        if(hls) {
            try {
                JSONArray variants=hlsQualities(SafeHttp.text(r.url,r.referer,2*1024*1024));
                for(int i=0;i<variants.length();i++)qualities.put(variants.getJSONObject(i));
                if(variants.length()==0)note="This server did not report separate video resolutions.";
            }catch(Exception e){note="Individual video resolutions could not be checked; best available is still offered.";}
        } else {
            JSONArray variants=fileQualities(r.files);
            for(int i=0;i<variants.length();i++)qualities.put(variants.getJSONObject(i));
            note=variants.length()==0?"This server offers a file whose resolution is not reported.":"File resolutions are reported by the source.";
        }
        String label=c.label;
        if("megaplay".equals(c.provider)||"direct-mega".equals(c.provider)||"gogomega".equals(c.provider))label+=" - MegaPlay SUB";
        return new JSONObject().put("id",c.id).put("label",label).put("qualities",qualities).put("note",note);
    }
    static JSONArray hlsQualities(String master) throws Exception {
        Pattern resolution=Pattern.compile("(?:^|,)RESOLUTION=([0-9]{2,5})x([0-9]{2,5})(?:,|$)",Pattern.CASE_INSENSITIVE);
        Map<String,int[]> found=new LinkedHashMap<>();
        for(String raw:master.split("\\r?\\n")) {
            String line=raw.trim();if(!line.startsWith("#EXT-X-STREAM-INF:"))continue;
            Matcher m=resolution.matcher(line.substring(line.indexOf(':')+1));
            if(!m.find())continue;
            int width=Integer.parseInt(m.group(1)),height=Integer.parseInt(m.group(2));
            if(width<100||height<100||width>8192||height>4320)continue;
            found.put("v:"+width+"x"+height,new int[]{width,height});
        }
        List<Map.Entry<String,int[]>> rows=new ArrayList<>(found.entrySet());
        Collections.sort(rows,(a,b)->{int byHeight=Integer.compare(b.getValue()[1],a.getValue()[1]);return byHeight!=0?byHeight:Integer.compare(b.getValue()[0],a.getValue()[0]);});
        JSONArray result=new JSONArray();
        for(Map.Entry<String,int[]> row:rows) {
            int w=row.getValue()[0],h=row.getValue()[1];
            boolean standard=h==144||h==240||h==288||h==360||h==480||h==576||h==720||h==1080||h==1440||h==2160||h==4320;
            String label=(standard?h+"p - ":"")+w+" x "+h;
            result.put(new JSONObject().put("id",row.getKey()).put("label",label));
        }
        return result;
    }
    private static JSONArray fileQualities(List<FileChoice> files) throws Exception {
        List<Integer> values=new ArrayList<>();
        for(FileChoice file:files)if(file.height>=144&&file.height<=4320&&!values.contains(file.height))values.add(file.height);
        Collections.sort(values,Collections.reverseOrder());JSONArray result=new JSONArray();
        for(int h:values)result.put(new JSONObject().put("id","f:"+h).put("label",h+"p - source file"));
        return result;
    }
    static Result megaPlay(String embed) throws Exception { return megaPlay(embed,"https://animesogo.to/"); }
    private static Result megaPlay(String embed,String referer) throws Exception {
        if (!hostIs(embed,"megaplay.buzz")) throw new IOException("Unsupported MegaPlay host");
        String page=SafeHttp.text(embed,referer,2*1024*1024);
        Document d=Jsoup.parse(page);
        String mediaId=htmlAttr(d.selectFirst("[data-id]"),"data-id");
        if (mediaId.isEmpty()) {
            Matcher m=Pattern.compile("File\\s+(\\d+)",Pattern.CASE_INSENSITIVE).matcher(page);
            if (m.find()) mediaId=m.group(1);
        }
        if (mediaId.isEmpty() || mediaId.length()>150) throw new IOException("MegaPlay did not provide a media ID");
        String server="";
        Matcher sm=Pattern.compile("(?:\\?|&)s=([A-Za-z0-9_-]+)").matcher(embed);
        if (sm.find()) server="&s="+q(sm.group(1));
        String json=SafeHttp.text("https://megaplay.buzz/stream/getSources?id="+q(mediaId)+server,embed,2*1024*1024);
        JSONObject data=new JSONObject(json);
        String file=megaSource(data);
        if (!Network.isHttps(file)) throw new IOException("MegaPlay did not provide a supported HLS stream");
        Result result=new Result();result.url=file;result.mime="application/x-mpegURL";result.referer="https://megaplay.buzz/";result.host="MegaPlay";
        JSONArray tracks=data.optJSONArray("tracks");
        if (tracks!=null) for (int i=0;i<Math.min(tracks.length(),30);i++) {
            JSONObject t=tracks.optJSONObject(i); if (t==null) continue;
            String kind=t.optString("kind"),label=t.optString("label").trim(),url=t.optString("file");
            String declared=t.optString("language",t.optString("lang",t.optString("srclang",""))).trim();
            if ((!"captions".equalsIgnoreCase(kind)&&!"subtitles".equalsIgnoreCase(kind)) || !Network.isHttps(url)) continue;
            boolean english=SubtitlePolicy.isEnglish(declared,label);
            if(label.isEmpty())label=english?"English":declared;
            if(label.isEmpty())continue;
            String lower=label.toLowerCase(Locale.ROOT),code=declared.toLowerCase(Locale.ROOT).replace('_','-');
            String lang=english?"en":!code.isEmpty()&&!"und".equals(code)&&!"unknown".equals(code)?code:
                lower.contains("indones")?"id":languageCode(lower);
            String mime=url.toLowerCase(Locale.ROOT).contains(".srt")?"application/x-subrip":"text/vtt";
            result.tracks.add(new Track(url,label,lang,mime,t.optBoolean("default",false)||english));
        }
        result.subtitleDescription=result.tracks.isEmpty()?"No subtitle tracks provided":"Available subtitle tracks";
        return result;
    }
    private static String languageCode(String label) {
        if(label.contains("arabic"))return "ar";if(label.contains("french"))return "fr";if(label.contains("german"))return "de";
        if(label.contains("spanish"))return "es";if(label.contains("portuguese"))return "pt";if(label.contains("italian"))return "it";
        if(label.contains("russian"))return "ru";if(label.contains("japanese"))return "ja";return "und";
    }
    static String megaSource(JSONObject data) throws Exception {
        String file="";boolean decrypted=false;
        String enc=data.optString("enc");
        if (!enc.isEmpty()) {
            byte[] key=Arrays.copyOf("i?LMTAx0Q6,:}50U".getBytes(StandardCharsets.UTF_8),32);
            byte[] iv="W0;27ToaUpl_P%'c".getBytes(StandardCharsets.UTF_8);
            Cipher cipher=Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new IvParameterSpec(iv));
            byte[] encrypted=Base64.decode(enc.replace('-','+').replace('_','/'),Base64.DEFAULT);
            String plain=new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8).trim();
            if (plain.startsWith("{")) file=new JSONObject(plain).optString("file");
            else if (plain.startsWith("[")) { JSONObject first=new JSONArray(plain).optJSONObject(0);if(first!=null)file=first.optString("file"); }
            decrypted=!file.isEmpty();
        }
        if (file.isEmpty()) {
            Object source=data.opt("sources");
            if(source instanceof String)file=(String)source;
            else if(source instanceof JSONObject)file=((JSONObject)source).optString("file");
            else if(source instanceof JSONArray) {
                Object first=((JSONArray)source).opt(0);
                if(first instanceof JSONObject)file=((JSONObject)first).optString("file");else if(first instanceof String)file=(String)first;
            }
        }
        if (!decrypted || file.matches("(?i).*?[?&]token=.*")) return file;
        Matcher m=Pattern.compile("/([a-f0-9]{32})/([a-f0-9]{32})/",Pattern.CASE_INSENSITIVE).matcher(file);
        if (!m.find()) return file;
        // The public player signs this URL. A longer expiry allows a download to resume after a temporary interruption.
        String payload=(System.currentTimeMillis()/1000+12*3600)+"|"+m.group(1).toLowerCase(Locale.ROOT)+"/"+m.group(2).toLowerCase(Locale.ROOT);
        Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec("MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s".getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
        int flags=Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING;
        String token=Base64.encodeToString(payload.getBytes(StandardCharsets.UTF_8),flags)+"."+Base64.encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)),flags);
        return file+(file.contains("?")?"&":"?")+"token="+q(token);
    }
    static boolean matchesLanguage(String label,String language) {
        String s=label.toLowerCase(Locale.ROOT);
        if("indonesian".equals(language))return s.contains("indonesia")||s.matches(".*\\bindo\\b.*");
        return s.contains("english")||s.matches(".*\\beng\\b.*");
    }
    private static int labelHeight(String value) {
        String text=value==null?"":value.toLowerCase(Locale.ROOT);
        Matcher m=Pattern.compile("(?<![0-9])([0-9]{3,4})\\s*p?(?![0-9])").matcher(text);
        if(m.find()){int h=Integer.parseInt(m.group(1));if(h>=144&&h<=4320)return h;}
        if(text.contains("full hd")||text.equals("fhd"))return 1080;
        if(text.equals("hd"))return 720;if(text.equals("sd"))return 480;return -1;
    }
    private static List<FileChoice> mediafireFiles(Document episode,String language) {
        List<FileChoice> result=new ArrayList<>();
        for(Element group:episode.select(".soradlg, .soraddlx")) {
            if(!matchesLanguage(group.select(".sorattlx, h3, h4").text(),language))continue;
            List<Element> rows=new ArrayList<>(group.select(".soraurlx"));if(rows.isEmpty())rows.add(group);
            for(Element row:rows) {
                int height=labelHeight(row.select("strong").text());
                for(Element a:row.select("a[href]")) {
                    String raw=a.absUrl("href");
                    if(!hostIs(raw,"www.mediafire.com")&&!hostIs(raw,"mediafire.com"))continue;
                    boolean duplicate=false;for(FileChoice prior:result)if(prior.url.equals(raw))duplicate=true;
                    if(!duplicate)result.add(new FileChoice(raw,height));
                }
            }
        }
        return result;
    }
    static String mediafireLink(Document episode,String language) {
        List<FileChoice> files=mediafireFiles(episode,language);return files.isEmpty()?"":files.get(0).url;
    }
    static String mediafireFile(String html,String base) {
        Document d=Jsoup.parse(html,base);Element a=d.selectFirst("#downloadButton[href]");
        if(a==null)return "";String u=a.absUrl("href");
        try {
            URL parsed=new URL(u);String host=parsed.getHost().toLowerCase(Locale.ROOT),path=parsed.getPath().toLowerCase(Locale.ROOT);
            if(Network.isHttps(u) && (host.equals("mediafire.com")||host.endsWith(".mediafire.com")) && (path.endsWith(".mp4")||path.endsWith(".m4v")||path.endsWith(".webm")||path.endsWith(".mkv"))) return u;
        } catch(Exception ignored) { }
        return "";
    }
    private static FileChoice chooseFile(List<FileChoice> files,String quality) throws IOException {
        if(quality.startsWith("v:"))throw new IOException("This server provides fixed video files, not that adaptive quality");
        if(files.isEmpty())throw new IOException("The server did not provide a video file");
        if(quality.startsWith("f:")) {
            int requested=Integer.parseInt(quality.substring(2));
            for(FileChoice file:files)if(file.height==requested)return file;
            throw new IOException("The chosen file quality is not available for this episode");
        }
        FileChoice best=files.get(0);for(FileChoice file:files)if(file.height>best.height)best=file;return best;
    }
    private static List<Candidate> wavesCandidates(JSONObject episode) throws Exception {
        String ids=episode.optString("ids");
        Matcher parts=Pattern.compile("^([0-9]{1,12})&eps=([0-9]{1,7}(?:\\.[0-9]{1,3})?)$").matcher(ids);
        if(!parts.matches())throw new IOException("Aniwaves did not provide valid episode server information");
        String base=Network.sourceBase("waves");
        JSONObject json=new JSONObject(Network.get(base+"/ajax/server/list?servers="+parts.group(1)+"&eps="+parts.group(2),true).text());
        Document doc=Jsoup.parse(json.optString("result"));List<Candidate> out=new ArrayList<>();Map<String,Integer> counts=new HashMap<>();
        for(Element group:doc.select(".type[data-type]")) {
            if(!"sub".equalsIgnoreCase(group.attr("data-type")))continue;
            for(Element el:group.select("[data-link-id]")) {
                String id=el.attr("data-link-id"),label=el.text().trim();
                if(id.isEmpty()||id.length()>1000||out.size()>=12)continue;
                if(label.isEmpty())label="Server";
                out.add(new Candidate(stableId("waves",label,counts),label,"echo",id,"waves"));
            }
        }
        if(out.isEmpty())throw new IOException("No subtitled Aniwaves servers were listed");
        return out;
    }
    private static Result echoVideo(String embed) throws Exception {
        if(!hostIs(embed,"play.echovideo.ru"))throw new IOException("This Aniwaves server is not a supported EchoVideo mirror");
        URL url=new URL(embed);
        if(!url.getPath().matches("^/embed-[0-9]{1,3}/[A-Za-z0-9_-]{1,1000}/?$"))throw new IOException("Unsupported EchoVideo embed");
        Document page=Jsoup.parse(SafeHttp.text(embed,Network.sourceBase("waves")+"/",2*1024*1024));
        Element screen=page.selectFirst("#screen[data-id]");String id=htmlAttr(screen,"data-id");
        if(id.isEmpty()||id.length()>1000)throw new IOException("EchoVideo did not return a source ID");
        String endpoint=new URL(url,"getSources?id="+q(id)).toString();
        if(!hostIs(endpoint,"play.echovideo.ru"))throw new IOException("Unsupported EchoVideo source endpoint");
        JSONObject data=new JSONObject(SafeHttp.text(endpoint,embed,2*1024*1024));
        String file=megaSource(data);
        if(!Network.isHttps(file))throw new IOException("EchoVideo did not return a supported video stream");
        Result result=new Result();result.url=file;result.mime="application/x-mpegURL";result.host="EchoVideo";result.referer="https://play.echovideo.ru/";
        JSONArray tracks=data.optJSONArray("tracks");
        if(tracks!=null)for(int i=0;i<Math.min(tracks.length(),60);i++) {
            JSONObject track=tracks.optJSONObject(i);if(track==null)continue;
            String kind=track.optString("kind"),label=track.optString("label").trim(),raw=track.optString("file");
            String declared=track.optString("language",track.optString("lang",track.optString("srclang",""))).trim();
            if(!"captions".equalsIgnoreCase(kind)&&!"subtitles".equalsIgnoreCase(kind))continue;
            String subtitle;
            try{subtitle=new URL(url,raw).toString();}catch(Exception ignored){continue;}
            if(!Network.isHttps(subtitle))continue;
            boolean english=SubtitlePolicy.isEnglish(declared,label);
            if(label.isEmpty())label=english?"English":declared;
            if(label.isEmpty())continue;
            String code=english?"en":!declared.isEmpty()?declared:languageCode(label.toLowerCase(Locale.ROOT));
            String mime=subtitle.toLowerCase(Locale.ROOT).contains(".srt")?"application/x-subrip":"text/vtt";
            result.tracks.add(new Track(subtitle,label,code,mime,track.optBoolean("default",false)||english));
        }
        result.subtitleDescription=result.tracks.isEmpty()?"No separate subtitle tracks provided":"Available subtitle tracks";
        return result;
    }
    private static List<Candidate> bashCandidates(JSONObject episode) throws Exception {
        URL url=new URL(episode.optString("url"));
        Matcher match=Pattern.compile("^/anime/([0-9]{1,10})/([0-9]{1,7})/?$").matcher(url.getPath());
        if(!match.matches())throw new IOException("AnimeBash did not provide a valid episode");
        JSONObject data=new JSONObject(Network.get(Network.sourceBase("bash")+"/api/watch/"+match.group(1)+"/"+match.group(2),true).text());
        JSONObject sub=data.optJSONObject("sub");List<Candidate> out=new ArrayList<>();Map<String,Integer> counts=new HashMap<>();
        if(sub!=null)for(String key:new String[]{"MEG1","MEG2"}) {
            String embed=sub.optString(key);
            if(!hostIs(embed,"megaplay.buzz")||!new URL(embed).getPath().contains("/stream/"))continue;
            boolean duplicate=false;for(Candidate old:out)if(old.reference.equals(embed))duplicate=true;
            if(!duplicate)out.add(new Candidate(stableId("bash",key,counts),key,"direct-mega",embed,"bash"));
        }
        if(out.isEmpty())throw new IOException("No compatible subtitled AnimeBash download server was listed");
        return out;
    }
    private static void addWordpressCandidate(List<Candidate> out,Map<String,Integer> counts,String source,String episodeUrl,String label,String raw) {
        if(raw==null||raw.trim().isEmpty()||out.size()>=12)return;
        try {
            URL parsed=new URL(new URL(episodeUrl),raw.trim());
            if("http".equalsIgnoreCase(parsed.getProtocol()))parsed=new URL("https",parsed.getHost(),parsed.getFile());
            String url=parsed.toString(),host=parsed.getHost().toLowerCase(Locale.ROOT);
            if(!Network.isHttps(url))return;
            String provider=(host.equals("dailymotion.com")||host.endsWith(".dailymotion.com"))?"dailymotion":
                (host.equals("ok.ru")||host.equals("www.ok.ru"))?"okru":
                host.equals("gogoanime.com.by")?"gogomega":
                host.equals("megaplay.buzz")?"direct-mega":"";
            if(provider.isEmpty() || ("rulz".equals(source)&&label.toLowerCase(Locale.ROOT).contains("dub")))return;
            for(Candidate old:out)if(old.reference.equals(url))return;
            String title=label.trim().isEmpty()?"Default server":label.trim();
            out.add(new Candidate(stableId(source+"-"+provider,title,counts),title,provider,url,source));
        }catch(Exception ignored){}
    }
    private static void addWordpressFragment(List<Candidate> out,Map<String,Integer> counts,String source,String url,String label,String encoded) {
        if(encoded==null||encoded.trim().isEmpty())return;
        try {
            String decoded=encoded.startsWith("https://")||encoded.startsWith("//")?encoded:new String(Base64.decode(encoded,Base64.DEFAULT),StandardCharsets.UTF_8);
            String raw=decoded.trim();
            if(raw.startsWith("https://")||raw.startsWith("//")) {addWordpressCandidate(out,counts,source,url,label,raw);return;}
            Document fragment=Jsoup.parse(decoded,url);
            for(Element frame:fragment.select("iframe[src],iframe[data-src],iframe[data-litespeed-src],video[src],source[src]")) {
                raw=frame.attr("data-litespeed-src");if(raw.isEmpty())raw=frame.attr("data-src");if(raw.isEmpty())raw=frame.attr("src");
                addWordpressCandidate(out,counts,source,url,label,raw);
            }
        }catch(Exception ignored){}
    }
    private static List<Candidate> wordpressCandidates(JSONObject episode,String source,String language) throws Exception {
        String url=episode.optString("url");Document d=Jsoup.parse(Network.get(url,true).text(),url);
        List<Candidate> out=new ArrayList<>();Map<String,Integer> counts=new HashMap<>();
        // These sites do not consistently label caption language. Do not claim it is English.
        for(Element option:d.select("select.mirror option[value]"))
            addWordpressFragment(out,counts,source,url,option.text(),option.attr("value"));
        for(Element option:d.select("[data-hash]"))
            addWordpressFragment(out,counts,source,url,option.text(),option.attr("data-hash"));
        Element frame=d.selectFirst("#pembed iframe");
        if(frame!=null) {
            String raw=frame.attr("data-litespeed-src");if(raw.isEmpty())raw=frame.attr("data-src");if(raw.isEmpty())raw=frame.attr("src");
            addWordpressCandidate(out,counts,source,url,"Default server",raw);
        }
        if(out.isEmpty())throw new IOException("No compatible download server was listed for this episode. Playback may still work.");
        return out;
    }
    private static List<Candidate> xinCandidates(JSONObject episode,String language) throws Exception {
        String url=episode.optString("url");Document d=Jsoup.parse(Network.get(url,true).text(),url);
        List<Candidate> out=new ArrayList<>();Map<String,Integer> counts=new HashMap<>();
        List<FileChoice> files=mediafireFiles(d,language);
        if(!files.isEmpty()) {
            String label="indonesian".equals(language)?"MediaFire - Indonesian subtitles":"MediaFire - English subtitles";
            Candidate c=new Candidate("xin-mediafire",label,"mediafire","");c.files.addAll(files);out.add(c);
        }
        for(Element option:d.select("select.mirror option[value]")) {
            if(out.size()>=12)break;
            String label=option.text().trim();if(!matchesLanguage(label,language))continue;
            String val=option.attr("value").trim();if(val.isEmpty())continue;
            try {
                String decoded=(val.startsWith("https://")||val.startsWith("//"))?val:new String(Base64.decode(val,Base64.DEFAULT),StandardCharsets.UTF_8);
                String raw=decoded.trim();
                if(!raw.startsWith("https://")&&!raw.startsWith("//")) {
                    Document fragment=Jsoup.parse(decoded,url);Element frame=fragment.selectFirst("iframe[src],iframe[data-src],iframe[data-lazy-src]");
                    raw=htmlAttr(frame,"src");if(raw.isEmpty())raw=htmlAttr(frame,"data-src");if(raw.isEmpty())raw=htmlAttr(frame,"data-lazy-src");
                }
                if(raw.isEmpty())continue;
                URL parsed=new URL(new URL(url),raw);String host=parsed.getHost().toLowerCase(Locale.ROOT);
                if("http".equalsIgnoreCase(parsed.getProtocol()))parsed=new URL("https",parsed.getHost(),parsed.getFile());
                if(!Network.isHttps(parsed.toString()))continue;
                String provider=(host.equals("dailymotion.com")||host.endsWith(".dailymotion.com"))?"dailymotion":
                    (host.equals("ok.ru")||host.equals("www.ok.ru"))?"okru":"";
                if(provider.isEmpty())continue;
                String id=stableId("xin-"+provider,label,counts);
                out.add(new Candidate(id,label,provider,parsed.toString()));
            }catch(Exception ignored) { }
        }
        if(out.isEmpty())throw new IOException("No supported download server was listed for the selected subtitle language");
        return out;
    }
    static Result okru(String embed,String quality) throws Exception {
        URL parsed=new URL(embed);String host=parsed.getHost().toLowerCase(Locale.ROOT);
        if(!Network.isHttps(embed)||!(host.equals("ok.ru")||host.equals("www.ok.ru"))||!parsed.getPath().startsWith("/videoembed/"))
            throw new IOException("Unsupported OK.ru video");
        Document doc=Jsoup.parse(SafeHttp.text(embed,"https://animexin.dev/",2*1024*1024));
        Element element=doc.selectFirst("[data-options]");
        if(element==null)throw new IOException("OK.ru did not provide video metadata");
        JSONObject options=new JSONObject(element.attr("data-options")),flash=options.optJSONObject("flashvars");
        Object raw=flash==null?null:flash.opt("metadata");
        JSONObject metadata=raw instanceof JSONObject?(JSONObject)raw:raw instanceof String?new JSONObject((String)raw):null;
        JSONArray videos=metadata==null?null:metadata.optJSONArray("videos");List<FileChoice> files=new ArrayList<>();
        if(videos!=null)for(int i=0;i<Math.min(20,videos.length());i++) {
            JSONObject video=videos.optJSONObject(i);if(video==null)continue;
            String file=video.optString("url"),name=video.optString("name").toLowerCase(Locale.ROOT);
            if(!Network.isHttps(file))continue;
            int h="full".equals(name)?1080:"hd".equals(name)?720:"sd".equals(name)?480:
                "low".equals(name)?360:"lowest".equals(name)?240:"mobile".equals(name)?144:
                ("ultra".equals(name)||"uhd".equals(name))?2160:labelHeight(name);
            files.add(new FileChoice(file,h));
        }
        FileChoice choice=chooseFile(files,quality);
        Result r=new Result();r.url=choice.url;r.mime="video/mp4";r.host="OK.ru";r.referer="https://ok.ru/";
        r.fixedHeight=choice.height;r.files.addAll(files);return r;
    }
    static Result dailyMotion(String embed) throws Exception {
        Matcher m=Pattern.compile("(?:[?&]video=|/(?:embed/video|video)/)([A-Za-z0-9]+)",Pattern.CASE_INSENSITIVE).matcher(embed);
        if(!m.find())throw new IOException("Dailymotion did not provide a video ID");
        JSONObject j=new JSONObject(SafeHttp.text("https://www.dailymotion.com/player/metadata/video/"+m.group(1),"https://www.dailymotion.com/",2*1024*1024));
        if(j.optBoolean("protected_delivery",false))throw new IOException("This video is protected and cannot be downloaded");
        JSONObject qualities=j.optJSONObject("qualities");JSONArray auto=qualities==null?null:qualities.optJSONArray("auto");
        if(auto!=null)for(int i=0;i<auto.length();i++) {
            JSONObject s=auto.optJSONObject(i); if(s==null)continue;String file=s.optString("url"),type=s.optString("type");
            if(Network.isHttps(file) && (type.toLowerCase(Locale.ROOT).contains("mpegurl") || file.contains(".m3u8"))) {
                Result r=new Result();r.url=file;r.mime="application/x-mpegURL";r.host="Dailymotion";r.referer="https://www.dailymotion.com/";return r;
            }
        }
        throw new IOException("Dailymotion did not provide an unprotected HLS stream");
    }
}
