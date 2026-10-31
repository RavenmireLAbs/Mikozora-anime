package app.moku.anime;

import android.content.Context;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.Map;

/** Do not evict the private cache while an already-open player is reading it. */
final class PrivateAccess {
    private static final Map<String,Integer> READERS=new HashMap<>();
    private PrivateAccess() {}
    static final class Session {
        final JSONObject meta;final boolean privateCopy;
        Session(JSONObject meta,boolean privateCopy){this.meta=meta;this.privateCopy=privateCopy;}
    }
    static synchronized Session begin(Context c,String id) {
        JSONObject meta=OfflineStore.get(c,id);
        if(meta==null||"folder".equals(meta.optString("storageMode")))return new Session(meta,false);
        Integer n=READERS.get(id);READERS.put(id,n==null?1:n+1);return new Session(meta,true);
    }
    static synchronized void end(String id) {
        Integer n=READERS.get(id);if(n==null||n<=1)READERS.remove(id);else READERS.put(id,n-1);
    }
    static synchronized boolean inUse(String id){Integer n=READERS.get(id);return n!=null&&n>0;}
}
