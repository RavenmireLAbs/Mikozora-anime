package app.moku.anime;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Direct Google Drive access for Mikozora device sync.
 *
 * MainActivity obtains a short-lived access token with Google's
 * AuthorizationClient. This class uses that token only against the Drive
 * REST API, only in Mikozora's app-created "Mikozora" folder, and only for
 * bounded mikozora-sync-<platform>-<device>.json files. It never interprets
 * payload contents; the shared JavaScript sync engine validates and merges
 * every peer file before touching app storage.
 */
final class GoogleDriveSyncStore {
    static final String FOLDER_NAME = "Mikozora";
    static final String RECONNECT_MESSAGE =
        "Google Drive needs to be reconnected. Connect Google Drive again in Settings.";

    private static final String PREFS = "moku_google_drive_sync";
    private static final String API_BASE = "https://www.googleapis.com/drive/v3";
    private static final String UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
    private static final String USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
    private static final String FOLDER_MIME = "application/vnd.google-apps.folder";
    private static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_FILES = 12;
    private static final int MAX_TOTAL_BYTES = 24 * 1024 * 1024;
    private static final Pattern FILE_NAME =
        Pattern.compile("^mikozora-sync-(android|windows)-[a-f0-9]{16}\\.json$");

    private GoogleDriveSyncStore() {}

    static final class DriveException extends IOException {
        final int status;

        DriveException(String message, int status) {
            super(message);
            this.status = status;
        }
    }

    private static final class Folder {
        final String id;
        final String created;

        Folder(String id, String created) {
            this.id = id == null ? "" : id;
            this.created = created == null ? "" : created;
        }
    }

    private static final class FolderSet {
        final List<Folder> folders;
        final Folder canonical;

        FolderSet(List<Folder> folders) {
            this.folders = folders;
            this.canonical = folders.isEmpty() ? null : folders.get(0);
        }
    }

    private static final class Candidate {
        final String id;
        final String name;
        final long size;
        final long modified;
        final List<String> parents;

        Candidate(String id, String name, long size, long modified, List<String> parents) {
            this.id = id;
            this.name = name;
            this.size = size;
            this.modified = modified;
            this.parents = parents;
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean isConnected(Context context) {
        return prefs(context).getBoolean("connected", false)
            && !prefs(context).getBoolean("needsReconnect", false);
    }

    static String account(Context context) {
        return prefs(context).getString("account", "");
    }

    static JSONObject settings(Context context) throws Exception {
        SharedPreferences saved = prefs(context);
        boolean connected = saved.getBoolean("connected", false);
        boolean needsReconnect = saved.getBoolean("needsReconnect", false);
        String account = saved.getString("account", "");
        return new JSONObject()
            .put("transport", "google")
            .put("available", true)
            .put("configured", connected)
            .put("granted", connected && !needsReconnect)
            .put("needsSetup", false)
            .put("needsReconnect", needsReconnect)
            .put("account", account == null ? "" : account)
            .put("displayName", saved.getString("displayName", ""))
            .put("name", account == null || account.isEmpty() ? "Google Drive" : account)
            .put("folderName", FOLDER_NAME);
    }

    static JSONObject saveConnected(Context context, String account, String displayName, String folderId) throws Exception {
        if (!prefs(context).edit()
                .putBoolean("connected", true)
                .putBoolean("needsReconnect", false)
                .putString("account", clean(account))
                .putString("displayName", clean(displayName))
                .putString("folderId", folderId == null ? "" : folderId)
                .commit()) throw new IOException("Could not remember the Google Drive connection.");
        return settings(context);
    }

    static void markNeedsReconnect(Context context) {
        try {
            if (prefs(context).getBoolean("connected", false))
                prefs(context).edit().putBoolean("needsReconnect", true).commit();
        } catch (Exception ignored) {}
    }

    static void markConnected(Context context) {
        try {
            if (prefs(context).getBoolean("connected", false)
                    && prefs(context).getBoolean("needsReconnect", false))
                prefs(context).edit().putBoolean("needsReconnect", false).commit();
        } catch (Exception ignored) {}
    }

    static JSONObject clear(Context context) throws Exception {
        if (!prefs(context).edit().clear().commit())
            throw new IOException("Could not disconnect Google Drive.");
        // Files already in the visible Mikozora Drive folder stay there;
        // only this device's stored connection state is removed.
        return settings(context);
    }

    static JSONObject profile(String accessToken) {
        String account = "";
        String displayName = "";
        try {
            JSONObject userinfo = requestJson(accessToken, "GET", USERINFO_URL, null, null);
            account = clean(userinfo.optString("email", ""));
            displayName = clean(userinfo.optString("name", ""));
        } catch (Exception ignored) {}
        if (account.isEmpty()) {
            try {
                LinkedHashMap<String, String> params = new LinkedHashMap<>();
                params.put("fields", "user(emailAddress,displayName)");
                JSONObject about = requestJson(accessToken, "GET", buildUrl(API_BASE + "/about", params), null, null);
                JSONObject user = about.optJSONObject("user");
                if (user != null) {
                    account = clean(user.optString("emailAddress", ""));
                    if (displayName.isEmpty()) displayName = clean(user.optString("displayName", ""));
                }
            } catch (Exception ignored) {}
        }
        try {
            return new JSONObject().put("account", account).put("displayName", displayName);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    static String ensureFolder(Context context, String accessToken) throws Exception {
        FolderSet folders = ensureFolders(accessToken, true);
        if (folders.canonical == null) throw new IOException("Google Drive did not provide the Mikozora sync folder.");
        saveFolderId(context, folders.canonical.id);
        markConnected(context);
        return folders.canonical.id;
    }

    static JSONObject readFiles(Context context, String accessToken) throws Exception {
        FolderSet set = ensureFolders(accessToken, true);
        if (set.canonical != null) saveFolderId(context, set.canonical.id);
        markConnected(context);

        List<Candidate> candidates = listSyncFiles(accessToken, set.folders);
        Collections.sort(candidates, (a, b) -> {
            int byModified = Long.compare(b.modified, a.modified);
            return byModified != 0 ? byModified : a.name.compareTo(b.name);
        });

        List<Candidate> selected = new ArrayList<>();
        long estimatedTotal = 0;
        for (Candidate candidate : candidates) {
            if (selected.size() >= MAX_FILES) break;
            if (candidate.size > MAX_FILE_BYTES) continue;
            long estimatedSize = Math.max(0, candidate.size);
            if (estimatedSize > 0 && estimatedTotal + estimatedSize > MAX_TOTAL_BYTES) continue;
            selected.add(candidate);
            estimatedTotal += estimatedSize;
        }

        JSONArray files = new JSONArray();
        long actualTotal = 0;
        for (Candidate candidate : selected) {
            try {
                byte[] bytes = request(accessToken, "GET",
                    API_BASE + "/files/" + encodePath(candidate.id) + "?alt=media",
                    null, null, MAX_FILE_BYTES);
                if (actualTotal + bytes.length > MAX_TOTAL_BYTES) continue;
                actualTotal += bytes.length;
                files.put(new JSONObject()
                    .put("name", candidate.name)
                    .put("text", new String(bytes, StandardCharsets.UTF_8))
                    .put("modifiedAt", candidate.modified));
            } catch (DriveException e) {
                if (e.status != 404 && e.status != 410) throw e;
                // One peer file can be trashed between listing and download.
            }
        }

        List<JSONObject> sorted = new ArrayList<>();
        for (int i = 0; i < files.length(); i++) sorted.add(files.optJSONObject(i));
        Collections.sort(sorted, (a, b) -> a.optString("name").compareTo(b.optString("name")));
        JSONArray output = new JSONArray();
        for (JSONObject file : sorted) if (file != null) output.put(file);
        return new JSONObject().put("files", output);
    }

    static JSONObject writeFile(Context context, String accessToken, String name, String text) throws Exception {
        if (name == null || !FILE_NAME.matcher(name).matches())
            throw new IOException("Invalid device-sync file name.");
        byte[] bytes = (text == null ? "" : text).getBytes(StandardCharsets.UTF_8);
        if (bytes.length == 0 || bytes.length > MAX_FILE_BYTES)
            throw new IOException("The device-sync file is too large.");

        FolderSet set = ensureFolders(accessToken, true);
        if (set.canonical == null) throw new IOException("Google Drive did not provide the Mikozora sync folder.");
        saveFolderId(context, set.canonical.id);
        markConnected(context);

        Candidate existing = null;
        for (Candidate candidate : listSyncFiles(accessToken, set.folders)) {
            if (!name.equals(candidate.name)) continue;
            if (existing == null || compareWriteCandidate(candidate, existing, set.canonical.id) < 0)
                existing = candidate;
        }

        if (existing == null) {
            JSONObject created = createFile(accessToken, set.canonical.id, name, new String(bytes, StandardCharsets.UTF_8));
            return new JSONObject().put("written", true).put("name", name).put("bytes", bytes.length)
                .put("id", created.optString("id", ""));
        }

        if (!existing.parents.contains(set.canonical.id)) moveToFolder(accessToken, existing, set);
        try {
            LinkedHashMap<String, String> params = new LinkedHashMap<>();
            params.put("uploadType", "media");
            params.put("fields", "id,name,parents");
            JSONObject updated = requestJson(accessToken, "PATCH",
                buildUrl(UPLOAD_BASE + "/files/" + encodePath(existing.id), params),
                bytes, "application/json; charset=UTF-8");
            return new JSONObject().put("written", true).put("name", name).put("bytes", bytes.length)
                .put("id", updated.optString("id", existing.id));
        } catch (DriveException e) {
            if (e.status != 404) throw e;
            JSONObject created = createFile(accessToken, set.canonical.id, name, new String(bytes, StandardCharsets.UTF_8));
            return new JSONObject().put("written", true).put("name", name).put("bytes", bytes.length)
                .put("id", created.optString("id", ""));
        }
    }

    private static int compareWriteCandidate(Candidate a, Candidate b, String canonicalId) {
        int aCanonical = a.parents.contains(canonicalId) ? 0 : 1;
        int bCanonical = b.parents.contains(canonicalId) ? 0 : 1;
        if (aCanonical != bCanonical) return Integer.compare(aCanonical, bCanonical);
        int byModified = Long.compare(b.modified, a.modified);
        return byModified != 0 ? byModified : a.id.compareTo(b.id);
    }

    private static void moveToFolder(String accessToken, Candidate file, FolderSet set) {
        try {
            StringBuilder remove = new StringBuilder();
            for (String parent : file.parents) {
                boolean known = false;
                for (Folder folder : set.folders) if (folder.id.equals(parent)) known = true;
                if (!known || parent.equals(set.canonical.id)) continue;
                if (remove.length() > 0) remove.append(',');
                remove.append(parent);
            }
            if (remove.length() == 0) return;
            LinkedHashMap<String, String> params = new LinkedHashMap<>();
            params.put("addParents", set.canonical.id);
            params.put("removeParents", remove.toString());
            params.put("fields", "id,parents");
            requestJson(accessToken, "PATCH", buildUrl(API_BASE + "/files/" + encodePath(file.id), params),
                "{}".getBytes(StandardCharsets.UTF_8), "application/json");
        } catch (Exception ignored) {
            // Updating the file in place still syncs; moving it is cleanup.
        }
    }

    private static JSONObject createFile(String accessToken, String folderId, String name, String text) throws Exception {
        String boundary = "mikozora-" + UUID.randomUUID().toString();
        JSONObject metadata = new JSONObject()
            .put("name", name)
            .put("parents", new JSONArray().put(folderId))
            .put("mimeType", "application/json")
            .put("appProperties", new JSONObject().put("mikozoraSync", "1"));
        String body = "--" + boundary + "\r\n"
            + "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            + metadata.toString() + "\r\n"
            + "--" + boundary + "\r\n"
            + "Content-Type: application/json; charset=UTF-8\r\n\r\n"
            + text + "\r\n"
            + "--" + boundary + "--\r\n";
        LinkedHashMap<String, String> params = new LinkedHashMap<>();
        params.put("uploadType", "multipart");
        params.put("fields", "id,name,parents");
        return requestJson(accessToken, "POST", buildUrl(UPLOAD_BASE + "/files", params),
            body.getBytes(StandardCharsets.UTF_8), "multipart/related; boundary=" + boundary);
    }

    private static FolderSet ensureFolders(String accessToken, boolean create) throws Exception {
        List<Folder> folders = listFolders(accessToken);
        if (folders.isEmpty() && create) {
            LinkedHashMap<String, String> params = new LinkedHashMap<>();
            params.put("fields", "id,name,createdTime,modifiedTime");
            JSONObject metadata = new JSONObject()
                .put("name", FOLDER_NAME)
                .put("mimeType", FOLDER_MIME)
                .put("appProperties", new JSONObject().put("mikozoraSync", "1"));
            JSONObject created = requestJson(accessToken, "POST", buildUrl(API_BASE + "/files", params),
                metadata.toString().getBytes(StandardCharsets.UTF_8), "application/json");
            String id = created.optString("id", "");
            if (id.isEmpty()) throw new IOException("Google Drive did not create the Mikozora sync folder.");
            folders.add(new Folder(id, created.optString("createdTime", "")));
        }
        return new FolderSet(folders);
    }

    private static List<Folder> listFolders(String accessToken) throws Exception {
        LinkedHashMap<String, String> params = new LinkedHashMap<>();
        params.put("q", "name = '" + escapeQuery(FOLDER_NAME) + "' and mimeType = '" + FOLDER_MIME + "' and trashed = false");
        params.put("spaces", "drive");
        params.put("pageSize", "20");
        params.put("orderBy", "createdTime");
        params.put("fields", "files(id,name,createdTime,modifiedTime)");
        JSONObject response = requestJson(accessToken, "GET", buildUrl(API_BASE + "/files", params), null, null);
        JSONArray files = response.optJSONArray("files");
        List<Folder> folders = new ArrayList<>();
        if (files != null) {
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.optJSONObject(i);
                if (file == null || !FOLDER_NAME.equals(file.optString("name", ""))) continue;
                String id = file.optString("id", "");
                if (!id.isEmpty()) folders.add(new Folder(id, file.optString("createdTime", "")));
            }
        }
        Collections.sort(folders, (a, b) -> {
            int byCreated = a.created.compareTo(b.created);
            return byCreated != 0 ? byCreated : a.id.compareTo(b.id);
        });
        return folders;
    }

    private static List<Candidate> listSyncFiles(String accessToken, List<Folder> folders) throws Exception {
        List<Candidate> result = new ArrayList<>();
        for (Folder folder : folders) {
            String pageToken = "";
            for (int page = 0; page < 3; page++) {
                LinkedHashMap<String, String> params = new LinkedHashMap<>();
                params.put("q", "'" + escapeQuery(folder.id) + "' in parents and trashed = false");
                params.put("spaces", "drive");
                params.put("pageSize", "100");
                if (!pageToken.isEmpty()) params.put("pageToken", pageToken);
                params.put("fields", "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents)");
                JSONObject response = requestJson(accessToken, "GET", buildUrl(API_BASE + "/files", params), null, null);
                JSONArray files = response.optJSONArray("files");
                if (files != null) {
                    for (int i = 0; i < files.length(); i++) {
                        JSONObject file = files.optJSONObject(i);
                        if (file == null) continue;
                        String id = file.optString("id", "");
                        String name = file.optString("name", "");
                        if (id.isEmpty() || !FILE_NAME.matcher(name).matches()
                                || FOLDER_MIME.equals(file.optString("mimeType", ""))) continue;
                        long size = parseLong(file.opt("size"));
                        List<String> parents = new ArrayList<>();
                        JSONArray rawParents = file.optJSONArray("parents");
                        if (rawParents != null) {
                            for (int p = 0; p < rawParents.length(); p++) parents.add(rawParents.optString(p, ""));
                        }
                        if (parents.isEmpty()) parents.add(folder.id);
                        result.add(new Candidate(id, name, size, parseTime(file.optString("modifiedTime", "")), parents));
                    }
                }
                pageToken = response.optString("nextPageToken", "");
                if (pageToken.isEmpty()) break;
            }
        }
        return result;
    }

    private static JSONObject requestJson(
            String accessToken, String method, String url, byte[] body, String contentType) throws Exception {
        byte[] bytes = request(accessToken, method, url, body, contentType, 4 * 1024 * 1024);
        if (bytes.length == 0) return new JSONObject();
        return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    }

    private static byte[] request(
            String accessToken, String method, String urlSpec, byte[] body, String contentType, int maxBytes) throws Exception {
        if (accessToken == null || accessToken.trim().isEmpty()) throw new IOException(RECONNECT_MESSAGE);
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlSpec);
            if (!"https".equalsIgnoreCase(url.getProtocol())
                    || !("www.googleapis.com".equalsIgnoreCase(url.getHost())
                        || "openidconnect.googleapis.com".equalsIgnoreCase(url.getHost())))
                throw new IOException("Google Drive returned an unexpected address.");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(30000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Authorization", "Bearer " + accessToken);
            connection.setRequestProperty("Accept", "application/json");
            if (body != null) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                if (contentType != null && !contentType.isEmpty())
                    connection.setRequestProperty("Content-Type", contentType);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body);
                    out.flush();
                }
            }

            int status = connection.getResponseCode();
            InputStream in = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            byte[] response = in == null ? new byte[0] : readBounded(in, status >= 200 && status < 300 ? maxBytes : 1024 * 1024);
            if (status < 200 || status >= 300) throw friendlyError(status, response);
            return response;
        } catch (DriveException e) {
            throw e;
        } catch (IOException e) {
            String message = e.getMessage() == null ? "" : e.getMessage();
            if (message.startsWith("Google Drive") || message.startsWith("A Google Drive") || RECONNECT_MESSAGE.equals(message))
                throw e;
            throw new IOException("Could not reach Google Drive. Check your internet connection and try again.");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static byte[] readBounded(InputStream in, int maxBytes) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int count;
        try (InputStream input = in) {
            while ((count = input.read(buffer)) != -1) {
                if (out.size() + count > maxBytes)
                    throw new IOException("A Google Drive sync file is too large for Mikozora to read.");
                out.write(buffer, 0, count);
            }
        }
        return out.toByteArray();
    }

    private static DriveException friendlyError(int status, byte[] body) {
        if (status == 401) return new DriveException(RECONNECT_MESSAGE, status);
        if (status == 403) return new DriveException(
            "Google Drive did not allow Mikozora to use its sync folder. Reconnect Google Drive and grant the Drive permission.", status);
        if (status == 404) return new DriveException("A Google Drive sync file was moved or deleted. Sync again.", status);
        if (status == 429 || status >= 500)
            return new DriveException("Google Drive is busy or unavailable. Try again in a moment.", status);
        return new DriveException("Google Drive could not complete that request. Try again.", status);
    }

    private static void saveFolderId(Context context, String folderId) {
        try {
            if (folderId != null && !folderId.equals(prefs(context).getString("folderId", "")))
                prefs(context).edit().putString("folderId", folderId).commit();
        } catch (Exception ignored) {}
    }

    private static String buildUrl(String base, Map<String, String> params) throws Exception {
        StringBuilder out = new StringBuilder(base);
        boolean first = !base.contains("?");
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (entry.getValue() == null || entry.getValue().isEmpty()) continue;
            out.append(first ? '?' : '&');
            first = false;
            out.append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8.name()));
            out.append('=');
            out.append(URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8.name()).replace("+", "%20"));
        }
        return out.toString();
    }

    private static String encodePath(String value) throws Exception {
        return URLEncoder.encode(value == null ? "" : value, StandardCharsets.UTF_8.name())
            .replace("+", "%20").replace("%7E", "~");
    }

    private static String escapeQuery(String value) {
        return String.valueOf(value == null ? "" : value).replace("\\", "\\\\").replace("'", "\\'");
    }

    private static long parseLong(Object value) {
        try {
            if (value instanceof Number) return Math.max(0, ((Number) value).longValue());
            return Math.max(0, Long.parseLong(String.valueOf(value)));
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static long parseTime(String value) {
        try {
            if (value == null || value.length() < 19) return 0;
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            format.setLenient(false);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            return Math.max(0, format.parse(value.substring(0, 19)).getTime());
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static String clean(String value) {
        String text = value == null ? "" : value.replaceAll("[\\u0000-\\u001f\\u007f]", " ").trim();
        return text.length() > 320 ? text.substring(0, 320) : text;
    }

    static String safeMessage(Throwable error) {
        String text = error == null ? "" : error.getMessage();
        if (text == null || text.trim().isEmpty()) return "Could not use Google Drive. Try again.";
        text = text.replaceAll("https?://\\S+", "[host]")
            .replaceAll("Bearer\\s+\\S+", "Bearer [token]")
            .replaceAll("ya29\\.[A-Za-z0-9._-]+", "[token]");
        return text.length() > 220 ? text.substring(0, 220) : text;
    }

    static boolean isAuthorizationError(Throwable error) {
        return error instanceof DriveException && ((DriveException) error).status == 401;
    }
}
