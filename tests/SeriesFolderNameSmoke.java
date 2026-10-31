package app.moku.anime;
import java.nio.charset.StandardCharsets;

/** JVM checks of the same folder-name logic used by Android exports. */
public final class SeriesFolderNameSmoke {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args){
        check("One Piece".equals(SeriesFolderName.fromTitle("One Piece")),"ordinary title preserved");
        check(SeriesFolderName.fromTitle("Soul Land 2: The Peerless Tang Sect").matches("Soul Land 2 The Peerless Tang Sect - [0-9a-f]{12}"),"unsafe punctuation sanitized with stable disambiguation");
        check(SeriesFolderName.fromTitle(" ../Secret\\Show/:*?\"<>|\nEpisode.. ").matches("Secret Show Episode - [0-9a-f]{12}"),"no path traversal, control or separators");
        check("Untitled series".equals(SeriesFolderName.fromTitle(null)),"null title fallback");
        check(SeriesFolderName.fromTitle("...  / ").matches("Untitled series - [0-9a-f]{12}"),"empty unsafe title fallback");
        check(SeriesFolderName.fromTitle("CON").matches("_CON - [0-9a-f]{12}"),"portable reserved name");
        check("é".equals(SeriesFolderName.fromTitle("e\u0301")),"unicode normalized");
        String title="Anime 🌸".repeat(80),folder=SeriesFolderName.fromTitle(title);
        check(folder.getBytes(StandardCharsets.UTF_8).length<=180,"common filename byte limit");
        check(folder.codePointCount(0,folder.length())<=100,"code point cap");
        check(!Character.isHighSurrogate(folder.charAt(folder.length()-1)),"no split surrogate");
        check(folder.equals(SeriesFolderName.fromTitle(title)),"repeat episodes resolve to same folder");
        check(!SeriesFolderName.fromTitle("One Piece").equals(SeriesFolderName.fromTitle("Soul Land")),"different series remain separated");
        check(!SeriesFolderName.fromTitle("A:B").equals(SeriesFolderName.fromTitle("A/B")),"different unsafe characters do not collapse titles together");
        check(!SeriesFolderName.fromTitle("A:B").equals(SeriesFolderName.fromTitle("A B")),"sanitized title does not merge with unchanged title");
        check(!SeriesFolderName.fromTitle(title+"1").equals(SeriesFolderName.fromTitle(title+"2")),"long titles sharing a prefix remain separate");
        String malformed=SeriesFolderName.fromTitle("Bad\ud800Title");
        for(int i=0;i<malformed.length();i++){
            char c=malformed.charAt(i);
            check(!Character.isSurrogate(c)||Character.isHighSurrogate(c)&&i+1<malformed.length()&&Character.isLowSurrogate(malformed.charAt(++i)),"reject invalid surrogate");
        }
        System.out.println("Series folder names passed: stable, safe, collision-resistant, portable, unicode and length checks.");
    }
}
