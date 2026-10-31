package app.moku.anime;

/** Deterministic source identity/host and legacy compatibility checks. */
public final class NativeSourceRulesSmoke {
    private static void yes(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args) {
        String[][] sources={{"sogo","https://animesogo.to"},{"suge","https://animesuge.cz"},{"anikoto","https://anikototv.to"},{"rulz","https://animerulz.com.in"},{"waves","https://aniwaves.ru"},{"bash","https://animebash.in"},{"xin","https://animexin.dev"},{"narul","https://naruldonghua.com"},{"stream","https://donghuastream.org"},{"world","https://donghuaworld.com"}};
        for(String[] s:sources) {
            yes(Network.sourceBase(s[0]).equals(s[1]),s[0]+" base unchanged");
            yes(Network.allowedSource(s[1]+"/episode/1")&&Network.matchesSource(s[0],s[1]+"/episode/1"),s[0]+" exact source accepted");
            yes(!Network.matchesSource(s[0],s[1].replace("https://","http://")+"/"),s[0]+" http rejected");
            yes(!Network.matchesSource(s[0],s[1]+".evil.test/"),s[0]+" suffix spoof rejected");
            yes(!Network.matchesSource(s[0],s[1].replace("https://","https://evil.test@")+"/"),s[0]+" credentials rejected");
            for(String[] other:sources)if(!other[0].equals(s[0]))yes(!Network.matchesSource(s[0],other[1]+"/episode/1"),s[0]+" cannot be paired with "+other[0]);
        }
        yes(!Network.allowedSource("https://127.0.0.1/private"),"private host rejected");
        yes(!Network.matchesSource("unknown","https://animesogo.to/watch/example"),"unknown source rejected");
        System.out.println("PASS source host rules: 10 sources, cross-source mismatches, spoofing and legacy IDs.");
    }
}
