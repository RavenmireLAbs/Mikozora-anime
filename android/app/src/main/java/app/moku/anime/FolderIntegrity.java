package app.moku.anime;

import android.content.Context;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;

/** Byte-for-byte verification before any private episode or subtitle is released. */
final class FolderIntegrity {
    interface Check { void active() throws Exception; }
    private FolderIntegrity() {}
    static JSONObject copy(Context c,InputStream input,Uri dest,Check check)throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");long bytes=0;
        try(InputStream in=input;OutputStream out=c.getContentResolver().openOutputStream(dest,"w")) {
            if(in==null||out==null)throw new IOException("Could not write to the selected folder.");
            byte[] buffer=new byte[128*1024];int n;
            while((n=in.read(buffer))!=-1){check.active();if(n==0)continue;out.write(buffer,0,n);digest.update(buffer,0,n);bytes+=n;}
            out.flush();
        }
        if(bytes==0)throw new IOException("The saved file was empty.");
        return new JSONObject().put("uri",dest.toString()).put("bytes",bytes).put("sha256",hex(digest.digest()));
    }
    static void verify(Context c,JSONObject pending,Check check)throws Exception {
        String tree=pending.optString("tree");
        if(tree.isEmpty()||!ExportStore.hasPermission(c,Uri.parse(tree)))throw new IOException("Folder access was lost. The in-app copy was kept.");
        JSONObject video=pending.getJSONObject("video");
        verifyOne(c,video,check);
        JSONArray subs=pending.optJSONArray("tracks");
        if(subs!=null)for(int i=0;i<subs.length();i++)verifyOne(c,subs.getJSONObject(i),check);
        Uri videoUri=content(video.optString("uri"));MediaExtractor extractor=new MediaExtractor();boolean hasVideo=false,hasAudio=false;
        try {
            extractor.setDataSource(c,videoUri,null);
            for(int i=0;i<extractor.getTrackCount();i++) {
                MediaFormat f=extractor.getTrackFormat(i);String mime=f.getString(MediaFormat.KEY_MIME);
                if(mime!=null&&mime.startsWith("video/"))hasVideo=true;
                if(mime!=null&&mime.startsWith("audio/"))hasAudio=true;
            }
        }finally{extractor.release();}
        if(!hasVideo||!hasAudio)throw new IOException("The saved file is missing a readable video or audio track. The in-app copy was kept.");
    }
    private static void verifyOne(Context c,JSONObject info,Check check)throws Exception {
        Uri uri=content(info.optString("uri"));long expected=info.optLong("bytes",-1),bytes=0;
        String expectedHash=info.optString("sha256");
        if(expected<=0||!expectedHash.matches("[a-f0-9]{64}"))throw new IOException("The saved file could not be verified.");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream in=c.getContentResolver().openInputStream(uri)) {
            if(in==null)throw new IOException("Could not read a saved file.");
            byte[] buffer=new byte[128*1024];int n;
            while((n=in.read(buffer))!=-1){check.active();if(n==0)continue;digest.update(buffer,0,n);bytes+=n;if(bytes>expected)throw new IOException("The saved file has an unexpected size.");}
        }
        if(bytes!=expected||!expectedHash.equals(hex(digest.digest())))throw new IOException("The saved file did not match the original. The in-app copy was kept.");
    }
    private static Uri content(String raw)throws IOException {
        Uri uri=Uri.parse(raw);if(!"content".equalsIgnoreCase(uri.getScheme()))throw new IOException("The saved file URI is invalid.");return uri;
    }
    private static String hex(byte[] bytes) {
        char[] alphabet="0123456789abcdef".toCharArray(),out=new char[bytes.length*2];
        for(int i=0;i<bytes.length;i++){out[i*2]=alphabet[(bytes[i]&255)>>>4];out[i*2+1]=alphabet[bytes[i]&15];}return new String(out);
    }
}
