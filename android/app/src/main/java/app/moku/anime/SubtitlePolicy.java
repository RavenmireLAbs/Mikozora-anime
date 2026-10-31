package app.moku.anime;

import java.util.Locale;
import java.util.regex.Pattern;

/** Conservative English identification for subtitle metadata, not audio or burned-in text. */
final class SubtitlePolicy {
    private static final Pattern ENGLISH_WORD=Pattern.compile("(?:^|[^a-z])(?:english|eng)(?:$|[^a-z])");
    private static final Pattern ENGLISH_TAG=Pattern.compile("^(?:en|eng)(?:[-_][a-z0-9]{2,8})*$");
    private SubtitlePolicy() {}

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
}
