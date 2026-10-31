package app.moku.anime;

import android.content.Context;
import android.media.MediaDataSource;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.StreamKey;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.common.util.Util;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.CacheSpan;
import androidx.media3.datasource.cache.ContentMetadata;
import androidx.media3.exoplayer.hls.playlist.HlsMultivariantPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylist;
import androidx.media3.exoplayer.hls.playlist.HlsPlaylistParser;
import androidx.media3.exoplayer.upstream.ParsingLoadable;
import androidx.media3.exoplayer.offline.Download;
import androidx.media3.exoplayer.offline.DownloadRequest;
import java.io.IOException;
import java.util.NavigableSet;

/** Err on the side of keeping the private copy if an embedded subtitle could be lost. */
@OptIn(markerClass=UnstableApi.class)
final class SubtitlePreservation {
    private SubtitlePreservation() {}
    static String reasonToKeepPrivate(Context c,Download download) {
        DownloadRequest request=download.request;
        int type=Util.inferContentTypeForUriAndMimeType(request.uri,request.mimeType);
        if(type==C.CONTENT_TYPE_HLS) {
            if(request.streamKeys.isEmpty())return "The source may contain in-stream subtitles that were not copied; the in-app copy was kept.";
            for(StreamKey key:request.streamKeys)
                if(key.groupIndex==HlsMultivariantPlaylist.GROUP_INDEX_SUBTITLE)
                    return "The source contains in-stream subtitles that were not copied; the in-app copy was kept.";
            try {
                HlsPlaylist playlist=ParsingLoadable.load(OfflineStore.cacheOnly(c,request).createDataSource(),new HlsPlaylistParser(),request.uri,C.DATA_TYPE_MANIFEST);
                if(playlist instanceof HlsMultivariantPlaylist) {
                    HlsMultivariantPlaylist master=(HlsMultivariantPlaylist)playlist;
                    if(master.muxedCaptionFormats!=null&&!master.muxedCaptionFormats.isEmpty())
                        return "The source contains embedded captions that may not be copied; the in-app copy was kept.";
                } else return "Could not confirm all source captions; the in-app copy was kept.";
            }catch(Exception e){return "Could not confirm all source captions; the in-app copy was kept.";}
            return "";
        }
        if(type!=C.CONTENT_TYPE_OTHER)return "This source format could not be checked for embedded subtitles; the in-app copy was kept.";
        MediaExtractor extractor=new MediaExtractor();
        try(CacheMedia input=new CacheMedia(c,download)) {
            extractor.setDataSource(input);boolean video=false,audio=false;
            for(int i=0;i<extractor.getTrackCount();i++) {
                MediaFormat format=extractor.getTrackFormat(i);String mime=format.getString(MediaFormat.KEY_MIME);
                if(isText(mime))return "The source contains embedded subtitles that were not copied; the in-app copy was kept.";
                if(mime!=null&&mime.startsWith("video/"))video=true;if(mime!=null&&mime.startsWith("audio/"))audio=true;
            }
            return video&&audio?"":"Could not verify all source tracks; the in-app copy was kept.";
        }catch(Exception e){return "Could not verify the source subtitles; the in-app copy was kept.";}
        finally{extractor.release();}
    }
    private static boolean isText(String mime) {
        if(mime==null)return false;String m=mime.toLowerCase(java.util.Locale.ROOT);
        return m.startsWith("text/")||m.contains("subrip")||m.contains("subtitle")||m.contains("vobsub")
            ||m.contains("ttml")||m.contains("cea-608")||m.contains("cea-708")||m.contains("tx3g")||m.contains("webvtt");
    }
    /** Random-access, cache-only source for inspecting a completed progressive file. */
    private static final class CacheMedia extends MediaDataSource {
        private final Context context;private final DownloadRequest request;private final long size;
        CacheMedia(Context context,Download download)throws IOException {
            this.context=context;this.request=download.request;
            DataSpec base=new DataSpec.Builder().setUri(request.uri).setKey(request.customCacheKey).build();
            String key=CacheScopes.keys(request).buildCacheKey(base);
            long length=ContentMetadata.getContentLength(OfflineStore.cache(context).getContentMetadata(key));
            if(length<=0)length=download.contentLength;
            if(length<=0) {
                NavigableSet<CacheSpan> spans=OfflineStore.cache(context).getCachedSpans(key);long end=0;
                for(CacheSpan span:spans){if(span.position>end||span.length<=0)break;end=Math.max(end,span.position+span.length);}
                length=end;
            }
            if(length<=0)throw new IOException("Cached file length is unknown");size=length;
        }
        @Override public long getSize(){return size;}
        @Override public int readAt(long position,byte[] buffer,int offset,int length)throws IOException {
            if(position>=size)return -1;if(length==0)return 0;
            int wanted=(int)Math.min((long)length,size-position);
            CacheDataSource input=OfflineStore.cacheOnly(context,request).createDataSource();
            try {
                input.open(new DataSpec.Builder().setUri(request.uri).setKey(request.customCacheKey).setPosition(position).setLength(wanted).build());
                return input.read(buffer,offset,wanted);
            }finally{input.close();}
        }
        @Override public void close(){}
    }
}
