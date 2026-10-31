package app.moku.anime;

import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.cache.CacheKeyFactory;
import androidx.media3.exoplayer.offline.DownloadRequest;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** Isolates the cache for each new episode; old requests retain their original cache keys. */
@OptIn(markerClass=UnstableApi.class)
final class CacheScopes {
    private static final byte[] VERSION="moku-cache-scope-v1".getBytes(StandardCharsets.UTF_8);
    private CacheScopes() {}
    static byte[] marker(){return VERSION.clone();}
    static boolean isolated(DownloadRequest request){return Arrays.equals(VERSION,request.data);}
    static String prefix(String id){return "moku-episode:"+id+":";}
    static CacheKeyFactory keys(DownloadRequest request){
        if(!isolated(request))return CacheKeyFactory.DEFAULT;
        String prefix=prefix(request.id);
        return spec->prefix+CacheKeyFactory.DEFAULT.buildCacheKey(spec);
    }
}
