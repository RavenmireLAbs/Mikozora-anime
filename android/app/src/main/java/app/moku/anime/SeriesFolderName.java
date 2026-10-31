package app.moku.anime;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.Locale;

/** Portable, deterministic folder names derived from series titles. */
final class SeriesFolderName {
    private SeriesFolderName() {}
    static String fromTitle(String title) {
        String original=Normalizer.normalize(title==null?"":title,Normalizer.Form.NFC);
        String text=original.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]"," ")
            .replaceAll("[\\s\\p{Z}]+"," ").trim()
            .replaceAll("^[. ]+|[. ]+$","").trim();
        boolean changed=!text.equals(original);
        if(text.isEmpty())text="Untitled series";
        String upper=text.toUpperCase(Locale.ROOT);
        if(upper.matches("(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\\..*)?")) {
            text="_"+text;changed=true;
        }
        String limited=limit(text,100,180);
        if(!limited.equals(text))changed=true;
        if(limited.isEmpty())limited="Untitled series";
        if(!changed)return limited;
        // A stable short digest prevents different titles such as A:B and A/B from being
        // merged after sanitization, and differentiates long titles sharing a prefix.
        String suffix=" - "+digest(original);
        String prefix=limit(text,100-suffix.length(),180-suffix.length());
        if(prefix.isEmpty())prefix="Untitled series";
        return prefix+suffix;
    }
    private static String limit(String text,int maxPoints,int maxBytes) {
        StringBuilder safe=new StringBuilder();int bytes=0,points=0;
        for(int i=0;i<text.length();) {
            int cp=text.codePointAt(i);
            if(cp>=0xd800&&cp<=0xdfff){i++;continue;} // reject malformed, unpaired surrogates
            int size=cp<=0x7f?1:cp<=0x7ff?2:cp<=0xffff?3:4;
            if(points>=maxPoints||bytes+size>maxBytes)break;
            safe.appendCodePoint(cp);bytes+=size;points++;i+=Character.charCount(cp);
        }
        return safe.toString().replaceAll("[. ]+$","").trim();
    }
    private static String digest(String title) {
        try {
            byte[] hash=MessageDigest.getInstance("SHA-256").digest(title.getBytes(StandardCharsets.UTF_8));
            char[] hex="0123456789abcdef".toCharArray();StringBuilder out=new StringBuilder(12);
            for(int i=0;i<6;i++){out.append(hex[(hash[i]&255)>>>4]);out.append(hex[hash[i]&15]);}
            return out.toString();
        } catch(Exception impossible){throw new IllegalStateException("SHA-256 is unavailable",impossible);}
    }
}
