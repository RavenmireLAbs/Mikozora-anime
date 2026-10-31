package app.moku.anime;

import android.content.Context;
import android.net.Uri;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.util.UriUtil;
import androidx.media3.common.util.Util;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.cache.CacheKeyFactory;
import androidx.media3.exoplayer.hls.playlist.HlsMediaPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadCursor;
import androidx.media3.exoplayer.offline.DownloadRequest;
import androidx.media3.exoplayer.offline.WritableDownloadIndex;
import androidx.media3.exoplayer.upstream.ParsingLoadable;
import org.json.JSONObject;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;

/** Safely releases older shared-cache downloads without breaking other private episodes. */
@OptIn(markerClass=UnstableApi.class)
final class LegacyCacheCleanup {
    private static final Object LOCK=new Object();
    private LegacyCacheCleanup() {}

    /** false means another old transfer is active and cleanup must be retried later. */
    static boolean remove(Context c,Download target) throws Exception {return remove(c,target,false);}
    static boolean remove(Context c,Download target,boolean explicitRemoval) throws Exception {
        synchronized(LOCK) {
            Download current=OfflineStore.getDownload(c,target.request.id);
            if(current==null)return true;
            if(current.state!=Download.STATE_COMPLETED)return false;
            Set<String> ours=resources(c,current.request),protectedKeys=new HashSet<>();
            try(DownloadCursor cursor=OfflineStore.manager(c).getDownloadIndex().getDownloads()) {
                while(cursor.moveToNext()) {
                    Download other=cursor.getDownload();
                    if(other.request.id.equals(current.request.id)||CacheScopes.isolated(other.request))continue;
                    // An unfinished old transfer can add references after inspection. Wait for it.
                    if(other.state!=Download.STATE_COMPLETED)return false;
                    JSONObject meta=OfflineStore.get(c,other.request.id);
                    if(meta!=null&&"folder".equals(meta.optString("storageMode"))&&!PrivateAccess.inUse(other.request.id))continue;
                    protectedKeys.addAll(resources(c,other.request));
                }
            }
            JSONObject state=OfflineStore.get(c,current.request.id);
            if(state==null||(!explicitRemoval&&!"folder".equals(state.optString("storageMode")))||PrivateAccess.inUse(current.request.id))return false;
            // Persist the point of no return only after all shared-cache checks succeeded.
            if(!explicitRemoval&&!OfflineStore.change(c,current.request.id,m->m.put("cleanupStarted",true)))return false;
            for(String key:ours)if(!protectedKeys.contains(key))OfflineStore.cache(c).removeResource(key);
            // Completed downloads are not in DownloadManager's active list. Remove only this
            // terminal index row, not the downloader's unfiltered set of other/shared HLS keys.
            ((WritableDownloadIndex)OfflineStore.manager(c).getDownloadIndex()).removeDownload(current.request.id);
            return true;
        }
    }

    private static String key(Uri uri){return CacheKeyFactory.DEFAULT.buildCacheKey(new DataSpec.Builder().setUri(uri).build());}
    private static void add(Set<String> out,String base,String relative){if(relative!=null&&!relative.isEmpty())out.add(key(UriUtil.resolveToUri(base,relative)));}
    static Set<String> resources(Context c,DownloadRequest request) throws IOException {
        Set<String> out=new HashSet<>();
        int type=Util.inferContentTypeForUriAndMimeType(request.uri,request.mimeType);
        if(type==C.CONTENT_TYPE_OTHER) {
            DataSpec spec=new DataSpec.Builder().setUri(request.uri).setKey(request.customCacheKey).build();
            out.add(CacheKeyFactory.DEFAULT.buildCacheKey(spec));return out;
        }
        if(type!=C.CONTENT_TYPE_HLS)throw new IOException("The old cache format cannot be safely cleaned yet.");
        out.add(key(request.uri));
        HlsPlaylist main=ParsingLoadable.load(OfflineStore.cacheOnly(c,request).createDataSource(),new HlsPlaylistParser(),request.uri,C.DATA_TYPE_MANIFEST);
        if(main instanceof HlsMediaPlaylist) {
            media(out,(HlsMediaPlaylist)main);return out;
        }
        if(!(main instanceof HlsMultivariantPlaylist))throw new IOException("Could not inspect the cached playlist.");
        HlsMultivariantPlaylist master=(HlsMultivariantPlaylist)main;
        if(!request.streamKeys.isEmpty())master=master.copy(request.streamKeys);
        for(Uri uri:master.mediaPlaylistUrls) {
            out.add(key(uri));
            HlsPlaylist child=ParsingLoadable.load(OfflineStore.cacheOnly(c,request).createDataSource(),
                new HlsPlaylistParser(master,null),uri,C.DATA_TYPE_MANIFEST);
            if(!(child instanceof HlsMediaPlaylist))throw new IOException("Could not inspect an old cached stream.");
            media(out,(HlsMediaPlaylist)child);
        }
        return out;
    }
    private static void media(Set<String> out,HlsMediaPlaylist playlist) {
        for(HlsMediaPlaylist.Segment segment:playlist.segments) {
            if(segment.initializationSegment!=null)part(out,playlist.baseUri,segment.initializationSegment);
            part(out,playlist.baseUri,segment);
        }
    }
    private static void part(Set<String> out,String base,HlsMediaPlaylist.SegmentBase part) {
        add(out,base,part.url);add(out,base,part.fullSegmentEncryptionKeyUri);
    }
}
