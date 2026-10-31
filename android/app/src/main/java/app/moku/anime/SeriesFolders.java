package app.moku.anime;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import java.io.IOException;

/** Locate or create a title folder inside an existing user-granted SAF tree. */
final class SeriesFolders {
    private static final String[] CHILD_COLUMNS={
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE
    };
    private SeriesFolders() {}

    static Uri findOrCreate(Context context,Uri tree,String folderName) throws Exception {
        ContentResolver resolver=context.getContentResolver();
        String rootId=DocumentsContract.getTreeDocumentId(tree);
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,rootId);
        String existingId=null;boolean fileConflict=false;
        try(Cursor cursor=resolver.query(children,CHILD_COLUMNS,null,null,null)) {
            if(cursor==null)throw new IOException("Could not list the selected folder. Choose a folder that supports subfolders.");
            int ids=cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int names=cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int types=cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            if(ids<0||names<0||types<0)throw new IOException("The storage provider cannot identify title folders.");
            while(cursor.moveToNext()) {
                if(!folderName.equals(cursor.getString(names)))continue;
                String id=cursor.getString(ids),mime=cursor.getString(types);
                if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)&&id!=null&&!id.isEmpty()) {
                    // Stable even if a cloud provider already contains duplicate folder names.
                    if(existingId==null||id.compareTo(existingId)<0)existingId=id;
                } else fileConflict=true;
            }
            Bundle extras=cursor.getExtras();
            if(extras!=null&&extras.getBoolean(DocumentsContract.EXTRA_LOADING,false))
                throw new IOException("The selected folder is still loading. Try saving again.");
            if(extras!=null&&extras.getString(DocumentsContract.EXTRA_ERROR)!=null)
                throw new IOException("The storage provider could not list the selected folder. Try again.");
        }
        if(existingId!=null)return DocumentsContract.buildDocumentUriUsingTree(tree,existingId);
        if(fileConflict)throw new IOException("A file already uses the title folder name. Rename that file and retry.");
        Uri root=DocumentsContract.buildDocumentUriUsingTree(tree,rootId);
        Uri created=DocumentsContract.createDocument(resolver,root,DocumentsContract.Document.MIME_TYPE_DIR,folderName);
        if(created==null)throw new IOException("Could not create a folder for this title. Choose a writable folder.");
        // Some providers silently rename documents; never report success into the wrong folder or
        // delete a newly created directory, as another app may already have placed files in it.
        try(Cursor cursor=resolver.query(created,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE},null,null,null)) {
            if(cursor==null||!cursor.moveToFirst())throw new IOException("Could not confirm the new title folder. Try again.");
            int name=cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int type=cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            if(name<0||type<0||!folderName.equals(cursor.getString(name))||!DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(type)))
                throw new IOException("The storage provider changed the title folder name. Choose another folder and retry.");
        }
        return created;
    }
}
