package app.moku.anime;

import org.json.JSONArray;
import org.json.JSONObject;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.select.Elements;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Fetches only source-provided episode listings; never loads players or invents missing episodes. */
final class EpisodeFetcher {
    interface TextSource { String get(String url) throws Exception; }
    static final TextSource NETWORK = url -> Network.getEpisodeList(url).text();
    private static final Pattern NUMBER = Pattern.compile("^\\d{1,7}(?:\\.\\d{1,3})?$");
    private static final Pattern NUMBER_IN_TEXT = Pattern.compile("(?:episode|eps?)\\s*([0-9]+(?:\\.[0-9]+)?)",Pattern.CASE_INSENSITIVE);
    private static final Pattern FIRST_NUMBER = Pattern.compile("\\b([0-9]+(?:\\.[0-9]+)?)\\b");
    private static final int LIMIT=10000;
    private EpisodeFetcher() {}

    static final class Episode {
        final String key,number,title,url;
        final double numeric;
        Episode(String key,String number,String title,String url,double numeric) {
            this.key=key;this.number=number;this.title=title;this.url=url;this.numeric=numeric;
        }
    }
    static List<Episode> fetch(String source,String series,TextSource network) throws Exception {
        if(!Network.matchesSource(source,series))throw new IOException("Invalid series source");
        String base=Network.sourceBase(source);
        if("bash".equals(source))return bash(series,base,network);
        Document page=Jsoup.parse(network.get(series),series);
        if("sogo".equals(source)||"suge".equals(source)||"anikoto".equals(source)||"waves".equals(source)) {
            Element id="sogo".equals(source)?page.selectFirst("#watch-page[data-id]"):page.selectFirst(".watch-wrap[data-id], #watch-main[data-id]");
            String pageId=id==null?"":id.attr("data-id").trim();
            if(!pageId.matches("[0-9]{1,15}"))throw new IOException("Series episode list is unavailable");
            JSONObject json=new JSONObject(network.get(base+"/ajax/episode/list/"+pageId+"?vrf="));
            Object result=json.opt("result");
            if(json.optInt("status")!=200||!(result instanceof String))throw new IOException("Source did not return an episode list");
            Document eps=Jsoup.parse((String)result);
            Elements links="sogo".equals(source)?eps.select("ul.episodes > li > a[data-num]"):eps.select("a[data-num][data-ids]");
            if(links.isEmpty()) {
                if(isUpcoming(page))return new ArrayList<>();
                throw new IOException("Source episode list is empty or unavailable");
            }
            Map<String,Episode> out=new LinkedHashMap<>();int i=0;
            for(Element e:links) {
                if(i++>=LIMIT)break;
                String raw=e.attr("data-num").trim(), slug=e.attr("data-slug").trim();
                if(slug.isEmpty())slug=raw;
                String number=canonical(raw);if(number.isEmpty())number=canonical(slug);
                String url="waves".equals(source)?episodeUrl(source,series,e.attr("href")):"";
                if(url.isEmpty()&&!slug.isEmpty())url=episodeUrl(source,series,series.replaceAll("/+$","")+"/ep-"+encode(slug));
                add(out,number,"Episode "+(number.isEmpty()?raw:number),url);
            }
            if(out.isEmpty())throw new IOException("Source episode links are unavailable");
            return new ArrayList<>(out.values());
        }
        if("xin".equals(source)||"rulz".equals(source)||"narul".equals(source)||"stream".equals(source)||"world".equals(source)) {
            Elements links=page.select(".eplister li a[href], .ep-item[data-number][href]");
            if(links.isEmpty()) {
                if(isUpcoming(page))return new ArrayList<>();
                throw new IOException("Source episode list is empty or unavailable");
            }
            Map<String,Episode> out=new LinkedHashMap<>();int count=0;
            for(Element e:links) {
                if(count++>=LIMIT)break;
                Element numberElement=e.selectFirst(".epl-num"), titleElement=e.selectFirst(".epl-title");
                String raw=numberElement!=null?numberElement.text():e.attr("data-number");
                if(raw.isEmpty())raw=e.text();
                String number=extractNumber(raw);
                String title=titleElement==null?"":titleElement.text().trim();
                if(title.isEmpty())title=number.isEmpty()?"New episode":"Episode "+number;
                add(out,number,title,episodeUrl(source,series,e.attr("href")));
            }
            if(out.isEmpty())throw new IOException("Source episode links are unavailable");
            return new ArrayList<>(out.values());
        }
        throw new IOException("Unsupported series source");
    }
    private static List<Episode> bash(String series,String base,TextSource network) throws Exception {
        Matcher m=Pattern.compile("^/anime/([0-9]{1,10})/?$").matcher(new URL(series).getPath());
        if(!m.matches())throw new IOException("Invalid AnimeBash series");
        String id=m.group(1);
        JSONObject detail=new JSONObject(network.get(base+"/api/anime/"+id));
        JSONObject watch=new JSONObject(network.get(base+"/api/watch/"+id));
        JSONArray episodes=watch.optJSONArray("episodes");
        if(detail.optJSONObject("title")==null)throw new IOException("AnimeBash did not return the series");
        // Only a real, source-provided list counts as available links. Empty upcoming
        // series are a valid baseline; reported totals alone do not prove availability.
        if(episodes==null||episodes.length()==0) {
            if("NOT_YET_RELEASED".equals(detail.optString("status")))return new ArrayList<>();
            throw new IOException("AnimeBash did not provide episode links");
        }
        List<JSONObject> sorted=new ArrayList<>();
        for(int i=0;i<Math.min(LIMIT,episodes.length());i++) {JSONObject ep=episodes.optJSONObject(i);if(ep!=null)sorted.add(ep);}
        if(sorted.isEmpty())throw new IOException("AnimeBash episode list is invalid");
        Collections.sort(sorted,(a,b)->Double.compare(a.optDouble("number",0),b.optDouble("number",0)));
        Map<String,Episode> out=new LinkedHashMap<>();
        for(int i=0;i<sorted.size();i++) {
            JSONObject row=sorted.get(i);
            // TVDB metadata can include episodes that have not aired yet. Preserve
            // the site's sequential watch number but never announce a future row.
            if(isFuture(row))continue;
            String number=String.valueOf(i+1),title=row.optString("title","").trim();
            if(title.isEmpty()||"null".equals(title))title="Episode "+number;
            add(out,number,title,base+"/anime/"+id+"/"+number);
        }
        return new ArrayList<>(out.values());
    }
    private static boolean isFuture(JSONObject row) {
        String utc=row.optString("airDateUtc","");
        if(utc.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}.*")) {
            try {
                java.text.SimpleDateFormat f=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss",java.util.Locale.US);
                f.setLenient(false);f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                return f.parse(utc.substring(0,19)).getTime()>System.currentTimeMillis();
            }catch(Exception ignored){}
        }
        String date=row.optString("airDate","");
        if(!date.matches("\\d{4}-\\d{2}-\\d{2}"))return false;
        java.text.SimpleDateFormat day=new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.US);
        day.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return date.compareTo(day.format(new java.util.Date()))>0;
    }
    private static boolean isUpcoming(Document page) {
        for(Element e:page.select(".spe > span, .meta > div, [itemprop=status]")) {
            String s=e.text().toLowerCase(java.util.Locale.ROOT);
            if(s.contains("status")&&(s.contains("upcoming")||s.contains("not yet aired")||s.contains("not yet released")||s.contains("not_yet_released")||s.contains("coming soon")))return true;
        }
        return false;
    }
    private static String encode(String s) throws Exception {return URLEncoder.encode(s,"UTF-8").replace("+","%20");}
    static String canonical(String value) {
        String s=value==null?"":value.trim();
        if(!NUMBER.matcher(s).matches())return "";
        try{return new BigDecimal(s).stripTrailingZeros().toPlainString();}catch(Exception ignored){return "";}
    }
    private static String extractNumber(String raw) {
        if(raw==null)return "";
        Matcher a=NUMBER_IN_TEXT.matcher(raw),b=FIRST_NUMBER.matcher(raw);
        return canonical(a.find()?a.group(1):b.find()?b.group(1):"");
    }
    private static String episodeUrl(String source,String series,String raw) {
        try {
            if(raw==null||raw.isEmpty()||raw.length()>2500)return "";
            URL u=new URL(new URL(series),raw.trim());
            String normalized=u.getProtocol()+"://"+u.getAuthority()+u.getPath();
            return Network.matchesSource(source,normalized)?normalized:"";
        }catch(Exception ignored){return "";}
    }
    private static void add(Map<String,Episode> out,String number,String title,String url) {
        if(url.isEmpty())return;
        String key=number.isEmpty()?"url:"+url:"number:"+number;
        if(key.length()>2700||out.containsKey(key))return;
        double n=0;try{if(!number.isEmpty())n=Double.parseDouble(number);}catch(Exception ignored){}
        out.put(key,new Episode(key,number,title.length()>300?title.substring(0,300):title,url,n));
    }
}
