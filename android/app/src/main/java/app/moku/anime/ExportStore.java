package app.moku.anime;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.annotation.OptIn;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.offline.Download;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import org.json.JSONObject;
import java.io.IOException;
import java.util.UUID;

/** Saved folder permission and the separately tracked external-copy queue. */
@OptIn(markerClass = UnstableApi.class)
final class ExportStore {
    private static final String PREFS="moku_export_folder";
    private static final Object QUEUE_LOCK=new Object();
    private ExportStore() {}
    private static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    static String folderUri(Context c){return prefs(c).getString("uri","");}
    static String folderName(Context c){return prefs(c).getString("name","");}
    static boolean hasPermission(Context c,Uri tree) {
        for(UriPermission p:c.getContentResolver().getPersistedUriPermissions())
            if(p.getUri().equals(tree)&&p.isReadPermission()&&p.isWritePermission())return true;
        return false;
    }
    static JSONObject settings(Context c) throws Exception {
        String raw=folderUri(c);boolean granted=false;
        try{if(!raw.isEmpty())granted=hasPermission(c,Uri.parse(raw));}catch(Exception ignored){}
        return new JSONObject().put("configured",!raw.isEmpty()).put("granted",granted)
            .put("name",folderName(c));
    }
    /** The caller has already persisted both read and write permission from the system picker. */
    static JSONObject saveFolder(Context c,Uri tree) throws Exception {
        if(tree==null||!"content".equalsIgnoreCase(tree.getScheme())||tree.getPathSegments().size()<2
                ||!"tree".equals(tree.getPathSegments().get(0))||!hasPermission(c,tree))
            throw new IOException("The folder did not grant read and write access.");
        Uri document=DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
        String name="";
        try(Cursor cursor=c.getContentResolver().query(document,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
            if(cursor!=null&&cursor.moveToFirst())name=cursor.getString(0);
        }catch(Exception ignored){}
        if(name==null||name.trim().isEmpty()) {
            name=DocumentsContract.getTreeDocumentId(tree);
            int split=Math.max(name.lastIndexOf('/'),name.lastIndexOf(':'));
            if(split>=0&&split+1<name.length())name=name.substring(split+1);
        }
        if(name==null||name.trim().isEmpty())name="Selected folder";
        if(name.length()>100)name=name.substring(0,100);
        if(!prefs(c).edit().putString("uri",tree.toString()).putString("name",name).commit())
            throw new IOException("Could not remember the folder.");
        // Keep older grants: an already queued export may still be using the previous folder.
        return settings(c);
    }
    static JSONObject clearFolder(Context c) throws Exception {
        if(!prefs(c).edit().clear().commit())throw new IOException("Could not update the folder.");
        // Existing user-owned files and permissions for in-progress jobs are deliberately untouched.
        return settings(c);
    }
    static String workName(String id){return "moku-export-"+id;}
    static JSONObject queue(Context c,String id) throws Exception {
        if(id==null||!id.matches("[a-f0-9]{32}"))throw new IOException("Invalid episode.");
        synchronized(QUEUE_LOCK) {
            JSONObject meta=OfflineStore.get(c,id);Download download=OfflineStore.getDownload(c,id);
            boolean cached=download!=null&&download.state==Download.STATE_COMPLETED;
            boolean saved=meta!=null&&"folder".equals(meta.optString("storageMode"))&&!meta.optString("exportUri").isEmpty();
            if(meta==null||(!cached&&!saved))throw new IOException("Wait for the episode to finish downloading first.");
            String state=meta.optString("exportStatus");
            if("queued".equals(state)||"exporting".equals(state)||"verifying".equals(state))return new JSONObject().put("queued",false);
            String tree=folderUri(c),name=folderName(c),job=UUID.randomUUID().toString();
            if(tree.isEmpty())throw new IOException("Choose a download folder in Settings first.");
            if(!hasPermission(c,Uri.parse(tree)))throw new IOException("Folder access was lost. Choose the folder again in Settings.");
            OneTimeWorkRequest work=new OneTimeWorkRequest.Builder(ExportWorker.class)
                .setInputData(new Data.Builder().putString("id",id).putString("tree",tree).putString("folderName",name).putString("job",job).build())
                .addTag("moku-export").build();
            if(!OfflineStore.change(c,id,data->{data.put("exportStatus","queued");data.put("exportError","");
                data.put("exportNextFolder",name);data.put("exportJob",job);data.remove("pendingExport");}))
                throw new IOException("The episode is no longer available.");
            // A just-finished worker may still be marked RUNNING for a moment after it sets
            // its terminal status. REPLACE avoids silently dropping an immediate retry.
            WorkManager.getInstance(c).enqueueUniqueWork(workName(id),ExistingWorkPolicy.REPLACE,work);
            return new JSONObject().put("queued",true);
        }
    }
    /** Called once a new in-app download completes. Earlier episodes are exported on request. */
    static void maybeAutoExport(Context c,String id) {
        try {
            JSONObject meta=OfflineStore.get(c,id);
            if(meta!=null&&meta.optString("exportStatus").isEmpty()&&!folderUri(c).isEmpty())queue(c,id);
        }catch(Exception e){
            if(OfflineStore.get(c,id)!=null) {
                OfflineStore.update(c,id,"exportStatus","failed");
                OfflineStore.update(c,id,"exportError",safeMessage(e));
            }
        }
    }
    static String safeMessage(Throwable e) {
        String text=e==null?"":e.getMessage();
        if(text==null||text.trim().isEmpty())return "Could not save the playable copy. Try again.";
        text=text.replaceAll("https?://\\S+","[host]").replaceAll("content://\\S+","[folder]");
        return text.length()>180?text.substring(0,180):text;
    }
}
