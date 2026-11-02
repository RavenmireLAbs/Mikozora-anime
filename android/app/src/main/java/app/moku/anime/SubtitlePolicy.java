package app.moku.anime;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Conservative English identification and user subtitle selections. */
final class SubtitlePolicy {
    private static final Pattern ENGLISH_WORD=Pattern.compile("(?:^|[^a-z])(?:english|eng)(?:$|[^a-z])");
    private static final Pattern ENGLISH_TAG=Pattern.compile("^(?:en|eng)(?:[-_][a-z0-9]{2,8})*$");
    private static final Pattern LANGUAGE_TAG=Pattern.compile("^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$");
    private static final Pattern TRACK_ID=Pattern.compile("^s:[a-f0-9]{32}$");
    private SubtitlePolicy() {}

    static final class Selection {
        final String mode;
        final JSONArray tracks;
        final Set<String> ids;
        final String preferredLanguage;
        private Selection(String mode,JSONArray tracks) throws Exception {
            this.mode=mode;
            this.tracks=tracks==null?new JSONArray():tracks;
            Set<String> values=new HashSet<>();
            String preferred="";
            for(int i=0;i<this.tracks.length();i++) {
                JSONObject track=this.tracks.optJSONObject(i);
                if(track==null)continue;
                values.add(track.optString("id"));
                if(preferred.isEmpty())preferred=track.optString("language");
            }
            ids=Collections.unmodifiableSet(values);
            preferredLanguage=preferred;
        }
        boolean auto(){return "auto".equals(mode);}
        boolean custom(){return "custom".equals(mode);}
        boolean none(){return "none".equals(mode);}
    }

    static Selection autoSelection() {
        try{return new Selection("auto",new JSONArray());}catch(Exception impossible){throw new AssertionError(impossible);}
    }

    static boolean englishOnly(String source) { return "sogo".equals(source)||"suge".equals(source)||"anikoto".equals(source)||"bash".equals(source)||"rulz".equals(source)||"waves".equals(source); }

    static String languageFor(String source,String selected) {
        return englishOnly(source)?"english":("indonesian".equals(selected)?"indonesian":"english");
    }

    /** Explicit language tags take precedence; otherwise inspect the track's display label. */
    static boolean isEnglish(String language,String label) {
        String code=language==null?"":language.trim().toLowerCase(Locale.ROOT);
        if(!code.isEmpty()&&!code.equals("und")&&!code.equals("unknown")) {
            return ENGLISH_TAG.matcher(code).matches()||"english".equals(code);
        }
        String name=label==null?"":label.trim().toLowerCase(Locale.ROOT);
        if(name.matches(".*\\bnon[-_ ]?english\\b.*"))return false;
        return ENGLISH_TAG.matcher(name).matches()||name.matches("^(?:en|eng)(?:[-_][a-z0-9]{2,8})?(?:$|[ (\\[].*)")
            ||ENGLISH_WORD.matcher(name).find();
    }

    static boolean keepTrack(String source,String language,String label) {
        return !englishOnly(source)||isEnglish(language,label);
    }

    static String cleanLabel(String label) {
        return (label==null?"":label).replaceAll("\\p{Cntrl}+"," ").replaceAll("\\s+"," ").trim();
    }

    static String languageCode(String language,String label) {
        if(isEnglish(language,label))return "en";
        String code=language==null?"":language.trim().toLowerCase(Locale.ROOT).replace('_','-');
        if("ind".equals(code)||"in".equals(code))return "id";
        if(!code.isEmpty()&&!"und".equals(code)&&!"unknown".equals(code)) {
            code=code.replaceAll("[^a-z0-9-]","").replaceAll("^-+|-+$","");
            if(code.length()>35)code=code.substring(0,35).replaceAll("-+$","");
            if(LANGUAGE_TAG.matcher(code).matches())return code;
        }
        String name=cleanLabel(label).toLowerCase(Locale.ROOT)+" "+code;
        if(name.contains("indones")||name.matches(".*\\bindo\\b.*"))return "id";
        if(name.contains("arabic"))return "ar";
        if(name.contains("bengali"))return "bn";
        if(name.contains("chinese"))return "zh";
        if(name.contains("czech"))return "cs";
        if(name.contains("danish"))return "da";
        if(name.contains("dutch"))return "nl";
        if(name.contains("filipino"))return "fil";
        if(name.contains("finnish"))return "fi";
        if(name.contains("french"))return "fr";
        if(name.contains("german"))return "de";
        if(name.contains("greek"))return "el";
        if(name.contains("hebrew"))return "he";
        if(name.contains("hindi"))return "hi";
        if(name.contains("hungarian"))return "hu";
        if(name.contains("italian"))return "it";
        if(name.contains("japanese"))return "ja";
        if(name.contains("korean"))return "ko";
        if(name.contains("malay"))return "ms";
        if(name.contains("norwegian"))return "no";
        if(name.contains("persian"))return "fa";
        if(name.contains("polish"))return "pl";
        if(name.contains("portuguese"))return "pt";
        if(name.contains("romanian"))return "ro";
        if(name.contains("russian"))return "ru";
        if(name.contains("spanish"))return "es";
        if(name.contains("swedish"))return "sv";
        if(name.contains("thai"))return "th";
        if(name.contains("turkish"))return "tr";
        if(name.contains("ukrainian"))return "uk";
        if(name.contains("urdu"))return "ur";
        if(name.contains("vietnamese"))return "vi";
        return "und";
    }

    static boolean isIndonesian(String language,String label) {
        return "id".equals(languageCode(language,label).split("-",2)[0]);
    }

    /** Stable cross-episode identity: provider language + label, never an expiring URL. */
    static String trackId(String language,String label) {
        String code=languageCode(language,label);
        String name=cleanLabel(label).toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+"," ").trim();
        if(name.isEmpty())name=code;
        try {
            byte[] digest=MessageDigest.getInstance("SHA-256").digest((code+"\n"+name).getBytes(StandardCharsets.UTF_8));
            StringBuilder out=new StringBuilder("s:");
            for(int i=0;i<16;i++)out.append(String.format(Locale.ROOT,"%02x",digest[i]));
            return out.toString();
        }catch(Exception impossible) {
            return "s:00000000000000000000000000000000";
        }
    }

    static JSONObject trackOption(String language,String label,boolean preferred,boolean defaultSelected) throws Exception {
        String code=languageCode(language,label);
        String name=cleanLabel(label);if(name.isEmpty())name=code;
        return new JSONObject().put("id",trackId(code,name)).put("label",name).put("language",code)
            .put("preferred",preferred).put("defaultSelected",defaultSelected);
    }

    static boolean defaultSelected(String source,String language,String label,boolean hls) {
        if(!hls)return keepTrack(source,language,label);
        if(englishOnly(source))return isEnglish(language,label);
        return isEnglish(language,label)||isIndonesian(language,label);
    }

    static Selection selectionFromInput(JSONObject input,String server) throws Exception {
        String mode=input==null?"auto":input.optString("subtitleMode","auto");
        if(!"auto".equals(mode)&&!"custom".equals(mode)&&!"none".equals(mode))throw new IOException("Invalid subtitle selection");
        if(!"custom".equals(mode))return new Selection(mode,new JSONArray());
        if("auto".equals(server))throw new IOException("Choose a server before selecting subtitle tracks");
        return cleanSelection(mode,input==null?null:input.optJSONArray("subtitleTracks"));
    }

    static Selection selectionFromRecord(JSONObject record) {
        try {
            String mode=record==null?"auto":record.optString("subtitleMode","auto");
            if("none".equals(mode))return new Selection("none",new JSONArray());
            if(!"custom".equals(mode))return autoSelection();
            return cleanSelection(mode,record.optJSONArray("subtitleSelection"));
        }catch(Exception ignored) {
            return autoSelection();
        }
    }

    private static Selection cleanSelection(String mode,JSONArray raw) throws Exception {
        if(raw==null||raw.length()<1||raw.length()>60)throw new IOException("Choose at least one subtitle track");
        JSONArray tracks=new JSONArray();Set<String> seen=new HashSet<>();
        for(int i=0;i<raw.length();i++) {
            JSONObject value=raw.optJSONObject(i);
            if(value==null)throw new IOException("Invalid subtitle selection");
            String id=value.optString("id"),label=cleanLabel(value.optString("label"));
            if(label.length()>160)label=label.substring(0,160).trim();
            if(!TRACK_ID.matcher(id).matches()||label.isEmpty())throw new IOException("Invalid subtitle selection");
            if(!seen.add(id))continue;
            tracks.put(new JSONObject().put("id",id).put("label",label)
                .put("language",languageCode(value.optString("language"),label)));
        }
        if(tracks.length()==0)throw new IOException("Choose at least one subtitle track");
        return new Selection(mode,tracks);
    }

    static boolean matchesSelection(Selection selection,String language,String label) {
        return selection!=null&&selection.custom()&&selection.ids.contains(trackId(language,label));
    }

    static boolean keepForSelection(String source,Selection selection,String language,String label) {
        if(selection==null||selection.auto())return keepTrack(source,language,label);
        if(selection.none())return false;
        return matchesSelection(selection,language,label);
    }
}
