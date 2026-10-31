package app.moku.anime;

import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;

/** Pure per-title comparison. A failed fetch must never be passed to this reducer. */
final class EpisodeState {
    private EpisodeState() {}
    static List<JSONObject> apply(JSONObject track,List<EpisodeFetcher.Episode> episodes,long now) throws Exception {
        List<JSONObject> found=new ArrayList<>();
        JSONObject known=track.optJSONObject("known");
        if(known==null)known=new JSONObject();
        boolean baseline=track.optBoolean("baseline",false);
        double previousMax=track.optDouble("maxNumber",-1);
        if(Double.isNaN(previousMax)||Double.isInfinite(previousMax))previousMax=-1;
        double max=previousMax;
        JSONObject item=track.getJSONObject("item");
        String titleId=track.getString("id");
        // Compare every episode against the previous maximum, not the maximum of
        // earlier entries in this response: source listings may be in any order.
        for(EpisodeFetcher.Episode ep:episodes) {
            if(ep==null||ep.key==null||ep.key.isEmpty())continue;
            boolean wasKnown=known.has(ep.key);
            boolean later=ep.number.isEmpty()||ep.numeric>previousMax;
            if(baseline&&!wasKnown&&later) {
                JSONObject event=new JSONObject();
                event.put("id",digest(titleId+"\n"+ep.key));
                event.put("titleId",titleId);
                event.put("item",new JSONObject(item.toString()));
                event.put("episode",new JSONObject().put("number",ep.number).put("title",ep.title).put("url",ep.url));
                event.put("discoveredAt",now);
                event.put("read",false);
                found.add(event);
            }
            known.put(ep.key,true);
            if(!ep.number.isEmpty()&&ep.numeric>max)max=ep.numeric;
        }
        track.put("known",known);
        track.put("maxNumber",max);
        track.put("baseline",true);
        track.put("lastSuccess",now);
        track.put("lastAttempt",now);
        track.remove("error");
        return found;
    }
    static String digest(String input) throws Exception {
        byte[] bytes=MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder out=new StringBuilder(bytes.length*2);
        for(byte b:bytes)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
        return out.toString();
    }
}
