package app.moku.anime;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Folder access for Mikozora device sync.
 *
 * This is deliberately separate from ExportStore: a download/export folder
 * and a cross-device sync folder are different user choices. The grant is
 * only used for top-level mikozora-sync-<platform>-<device>.json files. The
 * native layer never interprets their contents; the shared JavaScript sync
 * engine validates and merges every peer file before touching app storage.
 */
final class SyncStore {
    private static final String PREFS = "moku_device_sync_folder";
    private static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_FILES = 12;
    private static final int MAX_TOTAL_BYTES = 24 * 1024 * 1024;
    private static final Pattern FILE_NAME =
        Pattern.compile("^mikozora-sync-(android|windows)-[a-f0-9]{16}\\.json$");
    private static final String[] CHILD_COLUMNS = {
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
        DocumentsContract.Document.COLUMN_MIME_TYPE,
        DocumentsContract.Document.COLUMN_SIZE,
        DocumentsContract.Document.COLUMN_LAST_MODIFIED
    };

    private SyncStore() {}

    private static final class Candidate {
        final Uri uri;
        final String documentId;
        final String name;
        final long size;
        final long modified;

        Candidate(Uri uri, String documentId, String name, long size, long modified) {
            this.uri = uri;
            this.documentId = documentId;
            this.name = name;
            this.size = size;
            this.modified = modified;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String folderUri(Context context) {
        return prefs(context).getString("uri", "");
    }

    private static String folderName(Context context) {
        return prefs(context).getString("name", "");
    }

    private static boolean hasPermission(Context context, Uri tree) {
        for (UriPermission permission : context.getContentResolver().getPersistedUriPermissions()) {
            if (permission.getUri().equals(tree)
                    && permission.isReadPermission() && permission.isWritePermission()) return true;
        }
        return false;
    }

    static JSONObject settings(Context context) throws Exception {
        String raw = folderUri(context);
        boolean granted = false;
        try {
            if (!raw.isEmpty()) granted = hasPermission(context, Uri.parse(raw));
        } catch (Exception ignored) {}
        return new JSONObject()
            .put("configured", !raw.isEmpty())
            .put("granted", granted)
            .put("name", folderName(context));
    }

    /** The caller has already persisted both read and write permission from the system picker. */
    static JSONObject saveFolder(Context context, Uri tree) throws Exception {
        if (!validTree(tree) || !hasPermission(context, tree))
            throw new IOException("The folder did not grant read and write access.");

        Uri document = DocumentsContract.buildDocumentUriUsingTree(
            tree, DocumentsContract.getTreeDocumentId(tree));
        String name = documentName(context, document);
        if (name.trim().isEmpty()) {
            name = DocumentsContract.getTreeDocumentId(tree);
            int split = Math.max(name.lastIndexOf('/'), name.lastIndexOf(':'));
            if (split >= 0 && split + 1 < name.length()) name = name.substring(split + 1);
        }
        if (name.trim().isEmpty()) name = "Selected folder";
        if (name.length() > 100) name = name.substring(0, 100);

        if (!prefs(context).edit().putString("uri", tree.toString()).putString("name", name).commit())
            throw new IOException("Could not remember the sync folder.");
        return settings(context);
    }

    static JSONObject clearFolder(Context context) throws Exception {
        if (!prefs(context).edit().clear().commit())
            throw new IOException("Could not update the sync folder.");
        // Files already placed in the user's shared folder stay there. Removing
        // them is a choice for the user or the sync provider, not a side effect
        // of disconnecting this device.
        return settings(context);
    }

    static JSONObject readFolder(Context context) throws Exception {
        Uri tree = requireTree(context);
        List<Candidate> candidates = listCandidates(context, tree);
        Collections.sort(candidates, (a, b) -> {
            int byModified = Long.compare(b.modified, a.modified);
            return byModified != 0 ? byModified : a.name.compareTo(b.name);
        });

        List<Candidate> selected = new ArrayList<>();
        long estimatedTotal = 0;
        for (Candidate candidate : candidates) {
            if (selected.size() >= MAX_FILES) break;
            if (candidate.size > MAX_FILE_BYTES) continue;
            long estimatedSize = candidate.size < 0 ? 0 : candidate.size;
            if (estimatedTotal + estimatedSize > MAX_TOTAL_BYTES) continue;
            selected.add(candidate);
            estimatedTotal += estimatedSize;
        }

        JSONArray files = new JSONArray();
        long actualTotal = 0;
        ContentResolver resolver = context.getContentResolver();
        for (Candidate candidate : selected) {
            try (InputStream in = resolver.openInputStream(candidate.uri)) {
                if (in == null) continue;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buffer = new byte[16384];
                int count;
                boolean tooLarge = false;
                while ((count = in.read(buffer)) != -1) {
                    if (out.size() + count > MAX_FILE_BYTES
                            || actualTotal + out.size() + count > MAX_TOTAL_BYTES) {
                        tooLarge = true;
                        break;
                    }
                    out.write(buffer, 0, count);
                }
                if (tooLarge) continue;
                actualTotal += out.size();
                files.put(new JSONObject()
                    .put("name", candidate.name)
                    .put("text", new String(out.toByteArray(), StandardCharsets.UTF_8))
                    .put("modifiedAt", candidate.modified));
            } catch (Exception ignored) {
                // A provider may replace or remove a file between listing and
                // reading. One unavailable peer must not block all the others.
            }
        }

        // The shared parser ignores order, but a stable response makes native
        // behavior match Windows and keeps tests/debugging predictable.
        List<JSONObject> sorted = new ArrayList<>();
        for (int i = 0; i < files.length(); i++) sorted.add(files.optJSONObject(i));
        Collections.sort(sorted, (a, b) -> a.optString("name").compareTo(b.optString("name")));
        JSONArray output = new JSONArray();
        for (JSONObject file : sorted) if (file != null) output.put(file);
        return new JSONObject().put("files", output);
    }

    static JSONObject writeFile(Context context, String name, String text) throws Exception {
        if (name == null || !FILE_NAME.matcher(name).matches())
            throw new IOException("Invalid device-sync file name.");
        byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
        if (bytes.length == 0 || bytes.length > MAX_FILE_BYTES)
            throw new IOException("The device-sync file is too large.");

        Uri tree = requireTree(context);
        Uri target = null;
        for (Candidate candidate : listCandidates(context, tree)) {
            if (!name.equals(candidate.name)) continue;
            // Providers can expose duplicate display names. Pick a stable one;
            // the shared parser picks the highest revision among duplicates.
            if (target == null || candidate.documentId.compareTo(
                    DocumentsContract.getDocumentId(target)) < 0) target = candidate.uri;
        }
        if (target == null) {
            String rootId = DocumentsContract.getTreeDocumentId(tree);
            Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
            target = DocumentsContract.createDocument(context.getContentResolver(), root, "application/json", name);
            if (target == null) throw new IOException("Could not write to the sync folder. Check that it is available and try again.");
            if (!name.equals(documentName(context, target))) {
                try { DocumentsContract.deleteDocument(context.getContentResolver(), target); } catch (Exception ignored) {}
                throw new IOException("The storage provider changed the sync file name. Choose another folder and try again.");
            }
        }

        try (OutputStream out = context.getContentResolver().openOutputStream(target, "wt")) {
            if (out == null) throw new IOException("Could not write to the sync folder. Check that it is available and try again.");
            out.write(bytes);
            out.flush();
        } catch (IOException e) {
            if ("Could not write to the sync folder. Check that it is available and try again.".equals(e.getMessage())) throw e;
            throw new IOException("Could not write to the sync folder. Check that it is available and try again.");
        }
        return new JSONObject().put("written", true).put("name", name).put("bytes", bytes.length);
    }

    private static boolean validTree(Uri tree) {
        try {
            return tree != null
                && "content".equalsIgnoreCase(tree.getScheme())
                && tree.getPathSegments().size() >= 2
                && "tree".equals(tree.getPathSegments().get(0));
        } catch (Exception ignored) {
            return false;
        }
    }

    private static Uri requireTree(Context context) throws IOException {
        String raw = folderUri(context);
        if (raw.isEmpty()) throw new IOException("Choose a sync folder in Settings first.");
        Uri tree;
        try {
            tree = Uri.parse(raw);
        } catch (Exception e) {
            throw new IOException("Sync folder access was lost. Choose the folder again in Settings.");
        }
        if (!validTree(tree) || !hasPermission(context, tree))
            throw new IOException("Sync folder access was lost. Choose the folder again in Settings.");
        return tree;
    }

    private static List<Candidate> listCandidates(Context context, Uri tree) throws Exception {
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId);
        List<Candidate> result = new ArrayList<>();
        try (Cursor cursor = context.getContentResolver().query(children, CHILD_COLUMNS, null, null, null)) {
            if (cursor == null)
                throw new IOException("Could not read the sync folder. Check that it is available and try again.");
            int ids = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID);
            int names = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            int types = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE);
            int sizes = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE);
            int modified = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED);
            if (ids < 0 || names < 0 || types < 0)
                throw new IOException("Could not read the sync folder. Check that it is available and try again.");
            while (cursor.moveToNext()) {
                String documentId = cursor.getString(ids);
                String name = cursor.getString(names);
                String mime = cursor.getString(types);
                if (documentId == null || documentId.isEmpty() || name == null
                        || !FILE_NAME.matcher(name).matches()
                        || DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) continue;
                long size = sizes >= 0 && !cursor.isNull(sizes) ? cursor.getLong(sizes) : -1;
                long changed = modified >= 0 && !cursor.isNull(modified) ? cursor.getLong(modified) : 0;
                result.add(new Candidate(
                    DocumentsContract.buildDocumentUriUsingTree(tree, documentId),
                    documentId, name, size, Math.max(0, changed)));
            }
            Bundle extras = cursor.getExtras();
            if (extras != null && extras.getBoolean(DocumentsContract.EXTRA_LOADING, false))
                throw new IOException("The sync folder is still loading. Try again in a moment.");
            if (extras != null && extras.getString(DocumentsContract.EXTRA_ERROR) != null)
                throw new IOException("Could not read the sync folder. Check that it is available and try again.");
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException("Could not read the sync folder. Check that it is available and try again.");
        }
        return result;
    }

    private static String documentName(Context context, Uri document) {
        try (Cursor cursor = context.getContentResolver().query(
                document,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME },
                null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                return name == null ? "" : name;
            }
        } catch (Exception ignored) {}
        return "";
    }

    static String safeMessage(Throwable error) {
        String text = error == null ? "" : error.getMessage();
        if (text == null || text.trim().isEmpty()) return "Could not use the sync folder. Try again.";
        text = text.replaceAll("https?://\\S+", "[host]").replaceAll("content://\\S+", "[folder]");
        return text.length() > 180 ? text.substring(0, 180) : text;
    }
}
